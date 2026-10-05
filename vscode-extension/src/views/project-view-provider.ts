import * as vscode from "vscode";
import { AgileCampusApiClient, ApiError, validateServerUrl } from "../agilecampus/api-client";
import { TokenStore } from "../auth/token-store";
import { BindingStore, type WorkspaceBinding } from "../workspace/binding-store";
import { getGitWorkspaceSnapshot } from "../workspace/git-workspace";
import { parseWebviewMessage } from "./webview-message";
import { projectUrl } from "./project-url";
import type { HostMessage, ProjectSnapshot, TaskDetail, WebviewMessage } from "../types";
import { VisibleRefreshController, type RefreshResult } from "../sync/visible-refresh";

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
  private readonly tokenStore: TokenStore;
  private readonly bindingStore: BindingStore;
  private readonly refreshController: VisibleRefreshController;
  private viewDisposables: vscode.Disposable[] = [];
  private lastRefreshBindingKey: string | null = null;

  constructor(private readonly extensionUri: vscode.Uri, private readonly context: vscode.ExtensionContext) {
    this.tokenStore = new TokenStore(context.secrets);
    this.bindingStore = new BindingStore(context.workspaceState);
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
    this.viewDisposables.push(view.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (message) void this.handleMessage(message);
    }));
    this.viewDisposables.push(view.onDidChangeVisibility(() => {
      if (this.view === view) this.refreshController.setVisible(view.visible);
    }));
    this.viewDisposables.push(view.onDidDispose(() => {
      if (this.view !== view) return;
      this.view = undefined;
      this.refreshController.setVisible(false);
      this.clearViewListeners();
    }));
    this.refreshController.setVisible(view.visible);
    void this.refresh();
  }

  dispose(): void {
    this.refreshController.dispose();
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
    }
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
