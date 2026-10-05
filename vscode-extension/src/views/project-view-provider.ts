import * as vscode from "vscode";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { AgileCampusApiClient, ApiError, validateServerUrl } from "../agilecampus/api-client";
import { EntireAdapter } from "../adapters/entire-adapter";
import { TokenStore } from "../auth/token-store";
import { BindingStore, type WorkspaceBinding } from "../workspace/binding-store";
import { getGitWorkspaceSnapshot } from "../workspace/git-workspace";
import { parseWebviewMessage } from "./webview-message";
import { projectUrl } from "./project-url";
import type { HostMessage, ProjectSnapshot, SessionMemoryBindingView, SessionMemoryViewState, TaskDetail, WebviewMessage } from "../types";
import { VisibleRefreshController, type RefreshResult } from "../sync/visible-refresh";
import { LocalSessionStore } from "../session-memory/local-store";
import { codexConfigDirectory, hasCodexCaptureHook, installCodexCaptureHook, managedCodexHookScriptName, removeCodexCaptureHook } from "../session-memory/codex-hook-config";
import { SessionRecordPanel } from "./session-record-panel";
import { createSessionMemoryViewState } from "../session-memory/view-state";

const emptySnapshot = (state: ProjectSnapshot["state"] = "disconnected", error: string | null = null): ProjectSnapshot => ({
  state, error, updatedAt: null, projectName: "未连接项目", projectId: null,
  teamName: null, workspaceName: null, repository: null, currentBranch: null, tasks: [],
});

export class ProjectViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "agilecampus.projectView";
  private view?: vscode.WebviewView;
  private snapshot = emptySnapshot();
  private detailCache = new Map<string, TaskDetail>();
  private requestGeneration = 0;
  private loadedBindingKey: string | null = null;
  private activeWorkspaceUri: string | null = null;
  private focusedTaskId: string | null = null;
  private sessionMemoryGeneration = 0;
  private hookAlertGeneration = 0;
  private sessionMemoryPoller?: NodeJS.Timeout;
  private sessionMemoryPollInFlight = false;
  private readonly tokenStore: TokenStore;
  private readonly bindingStore: BindingStore;
  private readonly sessionStore: LocalSessionStore;
  private readonly refreshController: VisibleRefreshController;
  private viewDisposables: vscode.Disposable[] = [];
  private lastRefreshBindingKey: string | null = null;

  constructor(private readonly extensionUri: vscode.Uri, private readonly context: vscode.ExtensionContext) {
    this.tokenStore = new TokenStore(context.secrets);
    this.bindingStore = new BindingStore(context.workspaceState);
    this.sessionStore = new LocalSessionStore(context.globalStorageUri.fsPath);
    this.activeWorkspaceUri = context.globalState.get<string>("agileCampus.activeWorkspaceUri") ?? null;
    this.refreshController = new VisibleRefreshController(() => this.loadSnapshot());
    this.refreshController.setEnabled(Boolean(this.activeBinding()));
    void vscode.commands.executeCommand("setContext", "agileCampus.connected", Boolean(this.activeBinding()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.clearViewListeners();
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = this.html(view.webview);
    void this.refreshCodexHookStatus();
    void this.refreshCodexHookAlerts();
    this.viewDisposables.push(view.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (message) void this.handleMessage(message);
    }));
    this.viewDisposables.push(view.onDidChangeVisibility(() => {
      if (this.view === view) {
        this.refreshController.setVisible(view.visible);
        this.setSessionMemoryPolling(view.visible);
      }
    }));
    this.viewDisposables.push(view.onDidDispose(() => {
      if (this.view !== view) return;
      this.view = undefined;
      this.refreshController.setVisible(false);
      this.setSessionMemoryPolling(false);
      this.clearViewListeners();
    }));
    this.refreshController.setVisible(view.visible);
    this.setSessionMemoryPolling(view.visible);
    void this.refresh();
  }

  dispose(): void {
    this.refreshController.dispose();
    this.setSessionMemoryPolling(false);
    SessionRecordPanel.disposeAll();
    this.clearViewListeners();
    this.view = undefined;
  }

  private clearViewListeners(): void {
    for (const disposable of this.viewDisposables.splice(0)) disposable.dispose();
  }

  async connect(): Promise<void> {
    const configured = vscode.workspace.getConfiguration("agileCampus").get<string>("baseUrl") ?? "http://localhost:3000";
    let base: URL;
    try { base = validateServerUrl(configured); }
    catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "服务地址无效"); return; }

    const token = await vscode.window.showInputBox({
      title: "连接 AgileCampus",
      prompt: "输入设置页创建的 Personal API Token。令牌保存在 VS Code SecretStorage 中。",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value.startsWith("ac_") ? undefined : "令牌应以 ac_ 开头",
    });
    if (!token) return;

    const client = new AgileCampusApiClient(base.toString(), async () => token);
    let projects;
    try { projects = await client.listProjects(); }
    catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法连接 AgileCampus");
      return;
    }
    if (!projects.length) {
      void vscode.window.showInformationMessage("该账号暂未加入任何项目。令牌未保存。");
      return;
    }
    const selectedProject = await vscode.window.showQuickPick(projects.map((project) => ({
      label: project.name, description: `${project.teamName} · ${project.status}`,
      detail: `${project.doneCount}/${project.taskTotal} 项已完成`, project,
    })), { title: "选择 AgileCampus 项目", placeHolder: "选择此工作区要关联的项目" });
    if (!selectedProject) return;

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      void vscode.window.showErrorMessage("请先打开一个本地工作区文件夹，再关联项目。");
      return;
    }
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(
      folders.map((item) => ({ label: item.name, description: item.uri.fsPath, folder: item })),
      { title: "选择本地工作区", placeHolder: "项目绑定保存到所选工作区" },
    ).then((item) => item?.folder);
    if (!folder) return;
    const workspaceUri = folder.uri.toString();
    const previousBinding = this.bindingStore.get(workspaceUri);

    try {
      const project = await client.getProject(selectedProject.project.id);
      if (project.id !== selectedProject.project.id) throw new Error("服务返回的项目与所选项目不一致");
      await this.tokenStore.store(base.origin, workspaceUri, token);
      const binding: WorkspaceBinding = {
        serverOrigin: base.toString(), projectId: project.id, workspaceUri,
      };
      await this.bindingStore.set(binding);
      if (previousBinding && new URL(previousBinding.serverOrigin).origin !== base.origin) {
        await this.tokenStore.delete(new URL(previousBinding.serverOrigin).origin, workspaceUri);
      }
      this.activeWorkspaceUri = binding.workspaceUri;
      await this.context.globalState.update("agileCampus.activeWorkspaceUri", this.activeWorkspaceUri);
      await vscode.commands.executeCommand("setContext", "agileCampus.connected", true);
      this.detailCache.clear();
      this.focusedTaskId = null;
      this.sessionMemoryGeneration += 1;
      await this.refresh(true);
      void vscode.window.showInformationMessage(`已连接项目「${project.name}」`);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "保存项目连接失败");
    }
  }

  async disconnect(): Promise<void> {
    const binding = this.activeBinding();
    if (!binding) return;
    const choice = await vscode.window.showWarningMessage(
      "断开后会清除此工作区的令牌和项目绑定；本地检查点（如有）不会删除。",
      { modal: true }, "断开",
    );
    if (choice !== "断开") return;
    this.refreshController.setEnabled(false);
    await this.bindingStore.delete(binding.workspaceUri);
    await this.tokenStore.delete(new URL(binding.serverOrigin).origin, binding.workspaceUri);
    this.requestGeneration += 1;
    this.focusedTaskId = null;
    this.sessionMemoryGeneration += 1;
    if (this.activeWorkspaceUri === binding.workspaceUri) {
      this.activeWorkspaceUri = null;
      await this.context.globalState.update("agileCampus.activeWorkspaceUri", undefined);
      await vscode.commands.executeCommand("setContext", "agileCampus.connected", false);
    }
    this.detailCache.clear();
    this.snapshot = emptySnapshot();
    this.send({ type: "snapshot", snapshot: this.snapshot });
  }

  async selectProject(): Promise<void> {
    const binding = this.activeBinding();
    if (!binding) return this.connect();
    const generation = this.requestGeneration;
    const client = await this.clientFor(binding, generation);
    if (!client) return;
    try {
      const projects = await client.listProjects();
      if (generation !== this.requestGeneration || this.bindingIdentity(this.activeBinding()) !== this.bindingIdentity(binding)) return;
      const selected = await vscode.window.showQuickPick(projects.map((project) => ({
        label: project.name, description: `${project.teamName} · ${project.status}`, project,
      })), { title: "切换关联项目" });
      if (generation !== this.requestGeneration || this.bindingIdentity(this.activeBinding()) !== this.bindingIdentity(binding)) return;
      if (!selected || selected.project.id === binding.projectId) return;
      const project = await client.getProject(selected.project.id);
      if (generation !== this.requestGeneration || this.bindingIdentity(this.activeBinding()) !== this.bindingIdentity(binding)) return;
      await this.bindingStore.set({ ...binding, projectId: project.id });
      this.detailCache.clear();
      await this.refresh(true);
    } catch (error) { void vscode.window.showErrorMessage(this.errorMessage(error)); }
  }

  refresh(forceAfterCurrent = false): Promise<void> {
    const binding = this.activeBinding();
    const bindingKey = this.bindingIdentity(binding);
    const bindingChanged = this.lastRefreshBindingKey !== null && this.lastRefreshBindingKey !== bindingKey;
    this.lastRefreshBindingKey = bindingKey;
    this.refreshController.setEnabled(Boolean(binding));
    return this.refreshController.refreshNow(forceAfterCurrent || bindingChanged).then(() => undefined);
  }

  private async loadSnapshot(): Promise<RefreshResult> {
    const generation = ++this.requestGeneration;
    const binding = this.activeBinding();
    if (!binding) {
      this.loadedBindingKey = null;
      this.focusedTaskId = null;
      this.sessionMemoryGeneration += 1;
      void vscode.commands.executeCommand("setContext", "agileCampus.connected", false);
      this.snapshot = emptySnapshot();
      this.send({ type: "snapshot", snapshot: this.snapshot });
      return { ok: false, status: null };
    }
    const folder = vscode.workspace.workspaceFolders?.find((item) => item.uri.toString() === binding.workspaceUri);
    const bindingKey = `${binding.serverOrigin}|${binding.projectId}|${binding.workspaceUri}`;
    if (this.loadedBindingKey && this.loadedBindingKey !== bindingKey) this.detailCache.clear();
    const sameBinding = this.snapshot.projectId === binding.projectId && this.loadedBindingKey === bindingKey;
    this.snapshot = sameBinding
      ? { ...this.snapshot, state: "loading", error: null }
      : { ...emptySnapshot("loading"), projectId: binding.projectId, workspaceName: folder?.name ?? "本地工作区" };
    this.snapshot.workspaceName = folder?.name ?? "本地工作区";
    this.send({ type: "snapshot", snapshot: this.snapshot });
    const client = await this.clientFor(binding, generation);
    if (!client) return { ok: false, status: this.snapshot.state === "disconnected" ? 401 : null };
    try {
      const [project, tasks, git, projects] = await Promise.all([
        client.getProject(binding.projectId), client.listTasks(binding.projectId),
        getGitWorkspaceSnapshot(binding.workspaceUri), client.listProjects(),
      ]);
      if (generation !== this.requestGeneration || this.bindingIdentity(this.activeBinding()) !== this.bindingIdentity(binding)) {
        return { ok: true, status: null, stale: true };
      }
      if (project.id !== binding.projectId) throw new Error("服务返回了其他项目的数据");
      const projectSummary = projects.find((item) => item.id === project.id);
      if (!projectSummary) throw new ApiError("当前账号无法访问所选项目", 403);
      this.detailCache.clear();
      this.snapshot = {
        state: "ready", error: null, updatedAt: new Date().toISOString(),
        projectName: project.name, projectId: project.id, teamName: projectSummary.teamName,
        workspaceName: folder?.name ?? "本地工作区", repository: git?.repository ?? null,
        currentBranch: git?.currentBranch ?? null, tasks,
      };
      this.loadedBindingKey = bindingKey;
      this.send({ type: "snapshot", snapshot: this.snapshot });
      if (this.focusedTaskId && this.snapshot.tasks.some((task) => task.id === this.focusedTaskId)) {
        void this.refreshSessionMemory(this.focusedTaskId);
      } else if (this.focusedTaskId) {
        this.focusedTaskId = null;
        this.sessionMemoryGeneration += 1;
      }
      return { ok: true, status: null };
    } catch (error) {
      if (generation !== this.requestGeneration || this.bindingIdentity(this.activeBinding()) !== this.bindingIdentity(binding)) {
        return { ok: true, status: null, stale: true };
      }
      this.snapshot = { ...this.snapshot, state: "error", error: this.errorMessage(error) };
      this.send({ type: "snapshot", snapshot: this.snapshot });
      if (error instanceof ApiError && error.status === 401) {
        await this.tokenStore.delete(new URL(binding.serverOrigin).origin, binding.workspaceUri);
        await vscode.commands.executeCommand("setContext", "agileCampus.connected", false);
      }
      return { ok: false, status: error instanceof ApiError ? error.status : null };
    }
  }

  openProject(): void {
    const binding = this.activeBinding();
    const url = binding ? this.webUrl(binding, projectUrl(binding.serverOrigin, binding.projectId)) : this.defaultWebUrl("/projects");
    if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  openTask(taskId: string, space: "work" | "studio" = "work"): void {
    const binding = this.activeBinding();
    if (!binding || !this.snapshot.tasks.some((task) => task.id === taskId)) return;
    let path: string;
    try { path = projectUrl(binding.serverOrigin, binding.projectId, taskId, space); }
    catch { return; }
    const url = this.webUrl(binding, path);
    if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private async openTaskDetail(taskId: string): Promise<void> {
    const generation = this.requestGeneration;
    const binding = this.activeBinding();
    if (!binding || !this.snapshot.tasks.some((task) => task.id === taskId)) return;
    this.focusedTaskId = taskId;
    void this.refreshSessionMemory(taskId);
    const requestedBinding = this.bindingIdentity(binding);
    const cached = this.detailCache.get(taskId);
    if (cached) { this.send({ type: "taskDetail", taskId, detail: cached }); return; }
    const client = await this.clientFor(binding, generation);
    if (!client || generation !== this.requestGeneration) return;
    try {
      const detail = await client.getTask(taskId);
      if (detail.id !== taskId || detail.projectId !== binding.projectId) throw new Error("任务不属于当前项目");
      if (generation !== this.requestGeneration) return;
      if (this.bindingIdentity(this.activeBinding()) !== requestedBinding || !this.snapshot.tasks.some((task) => task.id === taskId)) return;
      this.detailCache.set(taskId, detail);
      this.send({ type: "taskDetail", taskId, detail });
    } catch (error) {
      if (this.bindingIdentity(this.activeBinding()) !== requestedBinding) return;
      if (generation !== this.requestGeneration) return;
      this.send({ type: "taskDetailError", taskId, error: this.errorMessage(error) });
    }
  }

  private bindingIdentity(binding: WorkspaceBinding | undefined): string | null {
    return binding ? `${binding.serverOrigin}|${binding.projectId}|${binding.workspaceUri}` : null;
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "refresh": await this.refresh(); break;
      case "connect": await this.connect(); break;
      case "disconnect": await this.disconnect(); break;
      case "selectProject": await this.selectProject(); break;
      case "openProject": this.openProject(); break;
      case "openTask": await this.openTaskDetail(message.taskId); break;
      case "viewAgentWork": this.openTask(message.taskId, "studio"); break;
      case "bindSession": await this.bindSession(message.taskId); break;
      case "enableCodexCapture": await this.enableCodexCapture(message.taskId); break;
      case "disableCodexCapture": await this.disableCodexCapture(); break;
      case "dismissHookAlert": await this.dismissHookAlert(message.alertId); break;
      case "refreshSessionMemory": await this.refreshSessionMemory(message.taskId); break;
      case "openSessionRecord": this.openSessionRecord(message.taskId, message.sessionKey); break;
      case "stopSessionCapture": await this.stopSessionCapture(message.taskId, message.sessionKey); break;
    }
  }

  private sessionContext(taskId: string): { binding: WorkspaceBinding; folder: vscode.WorkspaceFolder; taskTitle: string } | null {
    const binding = this.activeBinding();
    const task = this.snapshot.tasks.find((item) => item.id === taskId);
    const folder = vscode.workspace.workspaceFolders?.find((item) => item.uri.toString() === binding?.workspaceUri);
    if (!binding || !task || !folder || binding.projectId !== this.snapshot.projectId) return null;
    return { binding, folder, taskTitle: task.title };
  }

  private async refreshSessionMemory(taskId: string): Promise<void> {
    const generation = ++this.sessionMemoryGeneration;
    const context = this.sessionContext(taskId);
    if (!context) return;
    try {
      const bindings = await this.sessionStore.list(context.folder.uri.fsPath, context.binding.projectId, taskId);
      const hookConfigured = await this.hasCurrentCodexCaptureHook();
      this.send({ type: "codexHookStatus", configured: hookConfigured });
      const sessions = await this.sessionMemoryRows(bindings, hookConfigured);
      if (generation !== this.sessionMemoryGeneration || this.focusedTaskId !== taskId ||
          this.bindingIdentity(this.activeBinding()) !== this.bindingIdentity(context.binding)) return;
      const state: SessionMemoryViewState = createSessionMemoryViewState(taskId, sessions);
      this.send({ type: "sessionMemoryState", state });
    } catch (error) {
      if (generation !== this.sessionMemoryGeneration || this.focusedTaskId !== taskId) return;
      this.send({ type: "sessionMemoryState", state: { taskId, status: "error", detail: this.errorMessage(error), sessions: [] } });
    }
  }

  private async bindSession(taskId: string): Promise<void> {
    const context = this.sessionContext(taskId);
    if (!context) { await this.refreshSessionMemory(taskId); return; }
    if (!vscode.workspace.isTrusted) {
      await this.sendSessionError(taskId, "请先信任当前 VS Code 工作区，再读取本地 Codex 会话列表。");
      return;
    }
    this.send({ type: "sessionMemoryState", state: { taskId, status: "loading", detail: "正在检查当前工作区的 Codex 会话…", sessions: [] } });
    const adapter = new EntireAdapter();
    const result = await adapter.listSessions(context.folder.uri.fsPath);
    if (result.status !== "ok") {
      await this.sendSessionError(taskId, result.reason);
      return;
    }
    const existing = await this.sessionStore.list(context.folder.uri.fsPath, context.binding.projectId, taskId);
    const alreadyBound = new Set(existing.map((item) => item.providerSessionId));
    const candidates = result.value.filter((session) => !alreadyBound.has(session.sessionId));
    if (!candidates.length) {
      const detail = existing.length ? "此任务下的 Codex 会话均已关联或已停止；已停止的原生会话不能重新绑定，请启动新会话。" : "当前工作区没有可关联的 Codex CLI 会话；先在该工作区启动 Codex CLI，再重新检查。";
      if (existing.length) await this.sendSessionError(taskId, detail);
      else this.send({ type: "sessionMemoryState", state: { taskId, status: "unbound", detail, sessions: [] } });
      return;
    }
    const selected = await vscode.window.showQuickPick(candidates.map((session) => ({
      label: `${session.model ?? "Codex"} · ${session.branch ?? "无分支"}`,
      description: `${session.status} · ${session.turns ?? "?"} 轮 · ${session.startedAt ? new Date(session.startedAt).toLocaleString() : "开始时间未知"}`,
      session,
    })), { title: `关联会话到「${context.taskTitle}」`, placeHolder: "只列出当前工作区的 Codex CLI 会话；原生会话 ID 不显示" });
    if (!selected) { await this.refreshSessionMemory(taskId); return; }
    const consent = await vscode.window.showWarningMessage(
      "关联只建立本机任务映射，不会立刻采集对话。启用后，Codex Hook 会把用户输入、工具输入/输出和 Agent 最终答复保存到 VS Code 本机扩展数据目录；不会上传。提示词和工具结果可能含私密信息。",
      { modal: true }, "仅在本机保存并关联",
    );
    if (consent !== "仅在本机保存并关联") { await this.refreshSessionMemory(taskId); return; }
    try {
      await this.sessionStore.bind({ provider: "codex", providerSessionId: selected.session.sessionId,
        workspacePath: context.folder.uri.fsPath, projectId: context.binding.projectId, taskId });
      await this.refreshSessionMemory(taskId);
    } catch (error) {
      await this.sendSessionError(taskId, this.errorMessage(error));
    }
  }

  private async enableCodexCapture(taskId: string): Promise<void> {
    const context = this.sessionContext(taskId);
    if (!context) { await this.refreshSessionMemory(taskId); return; }
    if (!vscode.workspace.isTrusted) {
      await this.sendSessionError(taskId, "请先信任当前 VS Code 工作区，再启用本机记录。");
      return;
    }
    const bindings = await this.sessionStore.list(context.folder.uri.fsPath, context.binding.projectId, taskId);
    if (!bindings.some((item) => item.provider === "codex" && item.recording)) {
      this.send({ type: "sessionMemoryState", state: { taskId, status: "unbound", detail: "请先关联一个 Codex 会话。", sessions: [] } });
      return;
    }
    this.send({ type: "sessionMemoryState", state: { taskId, status: "loading", detail: "等待确认本机记录范围…", sessions: [] } });
    const configDirectory = codexConfigDirectory();
    const configFile = path.join(configDirectory, "hooks.json");
    const storageRoot = this.context.globalStorageUri.fsPath;
    const accepted = await vscode.window.showWarningMessage(
      `Codex Hook 配置是用户级：启用后，Codex 每次触发这些事件都会调用本机处理器；只有 session ID 匹配已关联会话且工作目录在所选工作区内时才落盘，其他会话不保存。保存内容包括用户输入、工具参数/结果和 Agent 最终答复，可能含敏感信息；不上传。之后还须在 Codex 中运行 /hooks 并审查、信任。\n\n配置：${configFile}\n记录目录：${path.join(storageRoot, "session-memory")}\n\n是否写入 Hook 配置？`,
      { modal: true }, "写入并打开配置",
    );
    if (accepted !== "写入并打开配置") { await this.refreshSessionMemory(taskId); return; }
    try {
      const destinationDirectory = path.join(storageRoot, "session-memory");
      await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
      const scriptPath = path.join(destinationDirectory, managedCodexHookScriptName());
      await copyFile(path.join(this.extensionUri.fsPath, "dist", managedCodexHookScriptName()), scriptPath);
      await chmod(scriptPath, 0o700);
      const file = await installCodexCaptureHook({ configDirectory, scriptPath, storageRoot });
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(document, { preview: false });
      await this.refreshSessionMemory(taskId);
      void vscode.window.showInformationMessage("配置已打开。请在 Codex 中运行 /hooks，核对 AgileCampus handler 并明确选择信任；确认后，新事件才会写入本机。", "我知道了");
    } catch (error) {
      await this.sendSessionError(taskId, this.errorMessage(error));
    }
  }

  async disableCodexCapture(): Promise<void> {
    const configDirectory = codexConfigDirectory();
    const accepted = await vscode.window.showWarningMessage(
      "移除 AgileCampus 的 4 个 Codex Hook 处理器后，所有已关联会话都将停止新增本地记录；历史不删除，其他 Hook 不变。之后若要恢复，需要重新启用并在 Codex 中复核信任。",
      { modal: true }, "禁用 AgileCampus Hook",
    );
    if (accepted !== "禁用 AgileCampus Hook") return;
    try {
      const result = await removeCodexCaptureHook(configDirectory);
      this.send({ type: "codexHookStatus", configured: await this.hasCurrentCodexCaptureHook(configDirectory) });
      if (!result.removed) {
        void vscode.window.showInformationMessage("未发现 AgileCampus 的 Codex Hook；配置未更改。", "打开配置")
          .then(async (choice) => {
            if (choice === "打开配置") {
              const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.file));
              await vscode.window.showTextDocument(document, { preview: false });
            }
          });
        return;
      }
      await vscode.window.showInformationMessage("AgileCampus Hook 已从 Codex 配置移除；历史记录保留在本机。", "打开配置")
        .then(async (choice) => {
          if (choice === "打开配置") {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.file));
            await vscode.window.showTextDocument(document, { preview: false });
          }
        });
      if (this.focusedTaskId) await this.refreshSessionMemory(this.focusedTaskId);
    } catch (error) {
      if (this.focusedTaskId) await this.sendSessionError(this.focusedTaskId, this.errorMessage(error));
      else void vscode.window.showErrorMessage(this.errorMessage(error));
    }
  }

  private openSessionRecord(taskId: string, sessionKey: string): void {
    const context = this.sessionContext(taskId);
    if (!context) return;
    void this.sessionStore.list(context.folder.uri.fsPath, context.binding.projectId, taskId).then((bindings) => {
      if (!bindings.some((item) => item.sessionKey === sessionKey)) return;
      SessionRecordPanel.open(this.extensionUri, this.sessionStore, sessionKey, context.taskTitle);
    }).catch((error) => {
      void this.sendSessionError(taskId, this.errorMessage(error));
    });
  }

  private async stopSessionCapture(taskId: string, sessionKey: string): Promise<void> {
    const context = this.sessionContext(taskId);
    if (!context) return;
    const bindings = await this.sessionStore.list(context.folder.uri.fsPath, context.binding.projectId, taskId);
    if (!bindings.some((item) => item.sessionKey === sessionKey && item.recording)) return;
    const choice = await vscode.window.showWarningMessage(
      "停止后保留这次会话的本地历史，但同一原生会话不能重新关联；要继续记录时请新建 Codex 会话。",
      { modal: true }, "停止记录",
    );
    if (choice !== "停止记录") return;
    try {
      await this.sessionStore.unbind(sessionKey);
      await this.refreshSessionMemory(taskId);
    } catch (error) {
      await this.sendSessionError(taskId, this.errorMessage(error));
    }
  }

  private async sessionMemoryRows(bindings: Awaited<ReturnType<LocalSessionStore["list"]>>, hookConfigured: boolean): Promise<SessionMemoryBindingView[]> {
    const sessions: SessionMemoryBindingView[] = [];
    for (const binding of bindings) {
      const summary = await this.sessionStore.summary(binding.sessionKey);
      sessions.push({
        sessionKey: summary.sessionKey,
        provider: summary.provider,
        recording: summary.recording,
        eventCount: summary.eventCount,
        latestSequence: summary.latestSequence,
        lastSavedAt: summary.lastSavedAt,
        hasGaps: summary.hasGaps,
        captureFailures: summary.captureFailures.map(({ occurredAt, detail }) => ({ occurredAt, detail })),
        hookConfigured: summary.provider === "codex" && hookConfigured,
      });
    }
    return sessions;
  }

  private async dismissHookAlert(alertId: string): Promise<void> {
    try {
      await this.sessionStore.dismissHookAlert(alertId);
      await this.refreshCodexHookAlerts();
    } catch (error) {
      void vscode.window.showErrorMessage(this.errorMessage(error));
    }
  }

  private async refreshCodexHookAlerts(): Promise<void> {
    const generation = ++this.hookAlertGeneration;
    try {
      const alerts = await this.sessionStore.listHookAlerts();
      if (generation !== this.hookAlertGeneration) return;
      this.send({ type: "codexHookAlerts", alerts, error: null });
    } catch (error) {
      if (generation !== this.hookAlertGeneration) return;
      this.send({ type: "codexHookAlerts", alerts: [], error: this.errorMessage(error) });
    }
  }

  private async sendSessionError(taskId: string, detail: string): Promise<void> {
    const context = this.sessionContext(taskId);
    let sessions: SessionMemoryBindingView[] = [];
    if (context) {
      try {
        const bindings = await this.sessionStore.list(context.folder.uri.fsPath, context.binding.projectId, taskId);
        sessions = await this.sessionMemoryRows(bindings, await this.hasCurrentCodexCaptureHook());
      } catch { /* Preserve the actionable operation error; the next status check can report journal errors. */ }
    }
    if (this.focusedTaskId === taskId) this.send({ type: "sessionMemoryState", state: { taskId, status: "error", detail, sessions } });
  }

  private setSessionMemoryPolling(enabled: boolean): void {
    if (this.sessionMemoryPoller) clearInterval(this.sessionMemoryPoller);
    this.sessionMemoryPoller = undefined;
    if (!enabled) return;
    this.sessionMemoryPoller = setInterval(() => {
      void this.refreshCodexHookStatus();
      void this.refreshCodexHookAlerts();
      const taskId = this.focusedTaskId;
      if (!taskId || this.sessionMemoryPollInFlight) return;
      this.sessionMemoryPollInFlight = true;
      void this.refreshSessionMemory(taskId).finally(() => { this.sessionMemoryPollInFlight = false; });
    }, 3000);
  }

  private async refreshCodexHookStatus(): Promise<void> {
    try {
      const configured = await this.hasCurrentCodexCaptureHook();
      this.send({ type: "codexHookStatus", configured });
    } catch {
      this.send({ type: "codexHookStatus", configured: false });
    }
  }

  private hasCurrentCodexCaptureHook(configDirectory = codexConfigDirectory()): Promise<boolean> {
    const storageRoot = this.context.globalStorageUri.fsPath;
    return hasCodexCaptureHook(configDirectory, {
      scriptPath: path.join(storageRoot, "session-memory", managedCodexHookScriptName()),
      storageRoot,
    });
  }

  private activeBinding(): WorkspaceBinding | undefined {
    if (this.activeWorkspaceUri) {
      const selected = this.bindingStore.get(this.activeWorkspaceUri);
      if (selected) return selected;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) {
      this.activeWorkspaceUri = folders[0].uri.toString();
      return this.bindingStore.get(this.activeWorkspaceUri);
    }
    return undefined;
  }

  private async clientFor(binding: WorkspaceBinding, generation = this.requestGeneration): Promise<AgileCampusApiClient | null> {
    const token = await this.tokenStore.get(new URL(binding.serverOrigin).origin, binding.workspaceUri);
    if (generation !== this.requestGeneration || this.bindingIdentity(this.activeBinding()) !== this.bindingIdentity(binding)) return null;
    if (!token) {
      void vscode.commands.executeCommand("setContext", "agileCampus.connected", false);
      this.snapshot = emptySnapshot("disconnected", "请连接 AgileCampus Personal API Token");
      this.send({ type: "snapshot", snapshot: this.snapshot });
      return null;
    }
    try { return new AgileCampusApiClient(binding.serverOrigin, async () => token); }
    catch (error) {
      this.snapshot = emptySnapshot("error", this.errorMessage(error));
      this.send({ type: "snapshot", snapshot: this.snapshot });
      return null;
    }
  }

  private webUrl(binding: WorkspaceBinding, path: string): string | null {
    try { return new URL(path.replace(/^\/+/, ""), validateServerUrl(binding.serverOrigin)).toString(); }
    catch { return null; }
  }

  private defaultWebUrl(path: string): string | null {
    try {
      const configured = vscode.workspace.getConfiguration("agileCampus").get<string>("baseUrl") ?? "http://localhost:3000";
      return new URL(path.replace(/^\/+/, ""), validateServerUrl(configured)).toString();
    } catch { void vscode.window.showErrorMessage("AgileCampus 服务地址无效"); return null; }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "读取 AgileCampus 失败，请重试";
  }

  private send(message: HostMessage): void {
    this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"));
    const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="${styleUri}"><title>AgileCampus</title></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 24 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
