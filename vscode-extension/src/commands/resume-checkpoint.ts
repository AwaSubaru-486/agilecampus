import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { AttemptStore, isRunningProcess, type LocalAttempt } from "../attempts/store";
import { inspectCodexCliVersion, startCodexContextSession } from "../adapters/process-runner";
import { CheckpointStore } from "../checkpoints/store";
import type { WorkCheckpoint } from "../checkpoints/types";
import { findObviousSecrets } from "../checkpoints/share-package";
import { buildContextPrompt, type SelectedMaterial } from "../handoff/launch";
import { evaluateHandoffPreflight, type PreflightResult } from "../handoff/preflight";
import type { RepositorySnapshot } from "../git/repository-service";
import { hasCommit, readRepositorySnapshot } from "../git/repository-service";
import { isRegisteredWorktree } from "../git/worktree-service";
import type { WorkspaceBinding } from "../workspace/binding-store";
import { createWorkspaceApi, getLocalOnlyRepositoryId, selectBoundWorkspace } from "./checkpoint-support";

const activeLaunchKeys = new Set<string>();
const activeAttemptIds = new Set<string>();
let output: vscode.OutputChannel | undefined;

export function registerResumeCheckpointCommand(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("AgileCampus Agent");
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.resumeCheckpoint", () => resumeCheckpoint(context)));
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.listAttempts", () => listAttempts(context)));
}

async function resumeCheckpoint(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage("接续 Agent 前必须信任当前 VS Code 工作区。"); return; }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const { folder, binding } = selected;
  const checkpointStore = new CheckpointStore(context.globalStorageUri.fsPath);
  const attemptStore = new AttemptStore(context.globalStorageUri.fsPath);
  let checkpoint: WorkCheckpoint | undefined;
  let launchLock = false;
  let processStarted = false;
  let launchKey: string | undefined;
  let persistentLease = false;
  let leaseAttemptId: string | undefined;
  try {
    await attemptStore.markInterruptedUnknown(activeAttemptIds);
    const records = await checkpointStore.list(binding.serverOrigin, binding.projectId);
    if (!records.length) { void vscode.window.showInformationMessage("当前项目没有本地检查点。"); return; }
    const choice = await vscode.window.showQuickPick(records.map(({ manifest }) => ({
      label: manifest.handoff.goal,
      description: `${manifest.repository.headSha.slice(0, 10)} · ${new Date(manifest.capturedAt).toLocaleString()}`,
      detail: `${manifest.taskSnapshot.title} · ${manifest.session.captureMode}`,
      id: manifest.id,
    })), { title: "选择 Agent 接续检查点" });
    if (!choice) return;
    const prepared = (await attemptStore.list()).filter((item) => item.checkpointId === choice.id && item.attemptKind === "parallel" && item.state === "prepared");
    const targetChoices: Array<{ label: string; description: string; key: string; attempt?: LocalAttempt }> = [
      { label: "当前干净工作区", description: "直接在当前仓库启动；已有未确认的单次尝试时会阻止重复启动", key: "single" },
      ...prepared.map((item) => ({
        label: `并行尝试 · ${item.branch ?? item.id.slice(0, 8)}`,
        description: `${item.baseSha?.slice(0, 10) ?? "无已验证基线"} · ${item.workdir}`,
        key: item.id,
        attempt: item,
      })),
    ];
    const targetChoice = await vscode.window.showQuickPick(targetChoices, { title: "选择 Agent 写入位置" });
    if (!targetChoice) return;
    const parallelAttempt = targetChoice.attempt;
    const workdir = parallelAttempt?.workdir ?? folder.uri.fsPath;
    const activeKey = `agilecampus:${await realpath(workdir)}`;
    launchKey = activeKey;
    if (activeLaunchKeys.has(activeKey) || parallelAttempt && activeAttemptIds.has(parallelAttempt.id)) {
      void vscode.window.showWarningMessage("此 Agent 尝试已在当前扩展实例启动。"); return;
    }
    activeLaunchKeys.add(activeKey);
    launchLock = true;
    if (parallelAttempt && parallelAttempt.state !== "prepared") {
      void vscode.window.showWarningMessage("选中的并行尝试不处于可启动状态。");
      return;
    }
    if (await attemptStore.hasPotentiallyActiveAttemptInWorkdir(workdir, parallelAttempt?.id)) {
      void vscode.window.showWarningMessage("此工作目录已有未确认结束的 Agent 尝试。请先核实之前的 Agent 是否已退出，再继续。");
      return;
    }
    checkpoint = await checkpointStore.read(binding.serverOrigin, binding.projectId, choice.id);
    if (!checkpoint) throw new Error("检查点已不存在");
    if (parallelAttempt) {
      const expectedBranch = `agilecampus/attempt-${parallelAttempt.id.replace(/-/g, "").slice(0, 12)}`;
      const expectedPath = `agilecampus-attempt-${parallelAttempt.id.slice(0, 8)}`;
      if (parallelAttempt.checkpointId !== checkpoint.id || parallelAttempt.projectId !== checkpoint.projectId ||
          parallelAttempt.baseSha !== checkpoint.repository.headSha || !parallelAttempt.branch ||
          (parallelAttempt.branch !== expectedBranch && !new RegExp(`^${expectedBranch}-[1-9][0-9]*$`).test(parallelAttempt.branch)) ||
          path.basename(parallelAttempt.workdir) !== expectedPath ||
          !await isRegisteredWorktree(folder.uri.fsPath, parallelAttempt.workdir)) {
        await showBlockers(["尝试记录与 Git 注册的 worktree 不一致；未启动 Agent。"]);
        return;
      }
    }

    const initial = await readFreshInput(context, binding, workdir, checkpoint);
    let preflight = evaluateHandoffPreflight({ ...initial, materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })), confirmedChangedTask: false });
    if (preflight.status === "blocked") { await showBlockers(preflight.blockers); return; }
    if (preflight.status === "needs-confirmation") {
      await showTaskChanges(checkpoint, preflight);
      const changedConsent = await vscode.window.showWarningMessage("任务要求、负责人或版本与检查点不同。要按当前服务端要求尝试吗？", { modal: true }, "按当前要求继续");
      if (changedConsent !== "按当前要求继续") return;
      preflight = evaluateHandoffPreflight({ ...initial, materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })), confirmedChangedTask: true });
    }
    if (preflight.status !== "ready") { void vscode.window.showWarningMessage("接续预检未通过；未启动 Agent。"); return; }

    const materialChoices = checkpoint.artifacts.length ? await vscode.window.showQuickPick(checkpoint.artifacts.map((artifact) => ({
      label: artifact.kind === "context" ? "上下文材料" : "原始 Agent transcript",
      description: `${Math.ceil(artifact.byteLength / 1024)} KiB · SHA-256 ${artifact.sha256.slice(0, 12)}`,
      picked: artifact.kind === "context",
      artifact,
    })), { title: "选择交给新 Agent 的材料", canPickMany: true, placeHolder: "仅选择本次继续工作所需的内容" }) : [];
    if (checkpoint.artifacts.length && !materialChoices) return;
    const materials: SelectedMaterial[] = [];
    for (const item of materialChoices ?? []) {
      const content = await checkpointStore.readArtifact(binding.serverOrigin, binding.projectId, checkpoint.id, item.artifact.id);
      if (!content) throw new Error("所选检查点附件不存在");
      const text = content.toString("utf8");
      const preview = await vscode.workspace.openTextDocument({
        language: item.artifact.kind === "context" ? "json" : "plaintext",
        content: text.length > 100_000 ? `${text.slice(0, 100_000)}\n\n[预览截断；Agent 实际接收完整材料]` : text,
      });
      await vscode.window.showTextDocument(preview, { preview: true });
      materials.push({ kind: item.artifact.kind, content });
    }
    const cli = await inspectCodexCliVersion();
    if (cli.status !== "ready") { void vscode.window.showErrorMessage(cli.reason); return; }

    const finalFresh = await readFreshInput(context, binding, workdir, checkpoint);
    const currentPlan = evaluateHandoffPreflight({ ...finalFresh, materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })), confirmedChangedTask: true });
    if (currentPlan.status !== "ready" || !samePreflightSnapshot(preflight, currentPlan)) {
      await showBlockers(currentPlan.status === "blocked" ? currentPlan.blockers : ["预检后任务、SHA、仓库或工作区状态已变化；请重新运行接续命令。"]);
      return;
    }
    const currentTask = finalFresh.task;
    if (!currentTask) { await showBlockers(["当前任务不可访问；未把检查点交给 Agent。"]); return; }
    const secretFindings = findObviousSecrets(JSON.stringify({ task: currentTask, handoff: checkpoint.handoff, materials: materials.map((item) => Buffer.from(item.content).toString("utf8")) }));
    if (secretFindings.length) {
      void vscode.window.showErrorMessage(`材料检测到可能的凭据格式（${secretFindings.join("、")}）；未将材料发给 Agent。请编辑并重新保存无凭据检查点。`);
      return;
    }
    let prompt: string;
    try { prompt = buildContextPrompt(checkpoint, currentTask, materials); }
    catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法准备 Agent 上下文"); return; }

    const accept = await vscode.window.showWarningMessage(
      `将启动新的 Codex CLI ${cli.version} 会话，不是恢复原 session。Agent 会在 ${workdir} 中读写；所选任务文本${materials.length ? "和附件" : "（未选附件）"}会发给你已配置的 Codex 服务。不会提交、推送或改平台任务状态。`,
      { modal: true }, "启动新的 Codex 会话",
    );
    if (accept !== "启动新的 Codex 会话") return;

    const attemptId = parallelAttempt?.id ?? randomUUID();
    leaseAttemptId = attemptId;
    if (await attemptStore.hasPotentiallyActiveAttemptInWorkdir(workdir, parallelAttempt?.id)) {
      void vscode.window.showWarningMessage("此工作目录已有未结束的 Agent 尝试；本次没有启动。");
      return;
    }
    persistentLease = await attemptStore.acquireWorkdirLease(workdir, attemptId);
    if (!persistentLease) {
      void vscode.window.showWarningMessage("此工作目录已被另一个 VS Code 窗口或 Agent 占用；本次没有启动。");
      return;
    }

    const lastFresh = await readFreshInput(context, binding, workdir, checkpoint);
    const lastPlan = evaluateHandoffPreflight({ ...lastFresh, materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })), confirmedChangedTask: true });
    if (lastPlan.status !== "ready" || !samePreflightSnapshot(preflight, lastPlan)) {
      await showBlockers(lastPlan.status === "blocked" ? lastPlan.blockers : ["确认对话期间工作状态发生变化；本次未启动，请重新预检。"]);
      return;
    }

    const attempt = parallelAttempt ?? await attemptStore.create({
      checkpointId: checkpoint.id, projectId: checkpoint.projectId, taskId: checkpoint.taskId,
      attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "launching",
      workdir, branch: preflight.plan.branch, baseSha: preflight.plan.baseSha,
      parentAttemptId: null, pid: null, exitCode: null, timedOut: false,
    }, attemptId);
    if (parallelAttempt) await attemptStore.update(attempt.id, { state: "launching" });
    activeAttemptIds.add(attempt.id);
    output?.show(true);
    output?.appendLine(`Attempt ${attempt.id}: launching context-only Codex CLI.`);
    let process: ReturnType<typeof startCodexContextSession>;
    try {
      process = startCodexContextSession(workdir, prompt, {
        onSessionStarted: async (sessionId) => {
          await attemptStore.update(attempt.id, { providerSessionId: sessionId, state: "running" });
          output?.appendLine(`Attempt ${attempt.id}: Codex session ${sessionId} started.`);
        },
      });
      processStarted = true;
      try {
        await attemptStore.updateWorkdirLeaseProcess(workdir, attempt.id, process.pid);
      } catch (error) {
        process.terminate();
        await process.completion.catch(() => undefined);
        await attemptStore.update(attempt.id, { state: "failed", pid: process.pid });
        await attemptStore.releaseWorkdirLease(workdir, attempt.id);
        persistentLease = false;
        processStarted = false;
        activeAttemptIds.delete(attempt.id);
        throw new Error(`无法记录 Agent 进程锁；已向 Agent 发送终止信号。${error instanceof Error ? error.message : ""}`);
      }
    } catch (error) {
      await attemptStore.update(attempt.id, { state: "failed" });
      activeAttemptIds.delete(attempt.id);
      throw error;
    }
    void process.completion.then(async (outcome) => {
      let completionHeadSha: string | null = null;
      let completionDirty: boolean | null = null;
      try {
        const localId = await getLocalOnlyRepositoryId(context, binding.workspaceUri);
        const snapshot = await readRepositorySnapshot(workdir, localId);
        completionHeadSha = snapshot.headSha;
        completionDirty = snapshot.dirty;
      } catch { /* Keep the observed repository result explicitly unavailable. */ }
      await attemptStore.update(attempt.id, {
        state: outcome.state, providerSessionId: outcome.providerSessionId,
        exitCode: outcome.exitCode, timedOut: outcome.timedOut,
        agentSummary: outcome.agentSummary, completionHeadSha, completionDirty,
      });
      output?.appendLine(`Attempt ${attempt.id}: ${outcome.state}; exit=${outcome.exitCode ?? "unknown"}; session=${outcome.providerSessionId ?? "unconfirmed"}.`);
      activeAttemptIds.delete(attempt.id);
      activeLaunchKeys.delete(activeKey);
      const label = outcome.state === "finished" ? "Codex 会话已完成" : outcome.state === "failed" ? "Codex 会话失败" : "Codex 会话结束状态待核对";
      void vscode.window.showInformationMessage(`${label}。Attempt ${attempt.id.slice(0, 8)}；退出码 ${outcome.exitCode ?? "未知"}。查看“AgileCampus: 查看本地 Agent 尝试”核对记录。`);
    }).catch(async () => {
      await attemptStore.update(attempt.id, { state: "awaiting_confirmation" }).catch(() => undefined);
      activeAttemptIds.delete(attempt.id);
      output?.appendLine(`Attempt ${attempt.id}: receipt persistence failed; state requires manual confirmation.`);
    }).finally(async () => {
      activeAttemptIds.delete(attempt.id);
      activeLaunchKeys.delete(activeKey);
      await attemptStore.releaseWorkdirLease(workdir, attempt.id).catch((error) => {
        output?.appendLine(`Attempt ${attempt.id}: could not release workdir lock: ${String(error)}.`);
      });
    });
    await attemptStore.update(attempt.id, { pid: process.pid });
    void vscode.window.showInformationMessage(`Agent 已启动为新的 context-only 会话。Attempt ${attempt.id.slice(0, 8)}；正在等待真实 session 回执。`);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "启动检查点接续失败");
  } finally {
    if (launchLock && !processStarted && launchKey) activeLaunchKeys.delete(launchKey);
    if (persistentLease && !processStarted && leaseAttemptId) {
      await attemptStore.releaseWorkdirLease(launchKey?.replace(/^agilecampus:/, "") ?? "", leaseAttemptId).catch(() => undefined);
    }
  }
}

async function listAttempts(context: vscode.ExtensionContext): Promise<void> {
  const store = new AttemptStore(context.globalStorageUri.fsPath);
  try {
    await store.markInterruptedUnknown(activeAttemptIds);
    const records = await store.list();
    if (!records.length) { void vscode.window.showInformationMessage("本机还没有 Agent 尝试记录。"); return; }
    const selected = await vscode.window.showQuickPick(records.map((item) => ({
      label: `${item.state} · ${item.checkpointId.slice(0, 8)}`,
      description: `${item.providerSessionId ?? "无 session 回执"} · ${new Date(item.startedAt).toLocaleString()}`,
      detail: `任务 ${item.taskId} · exit ${item.exitCode ?? "—"}${item.timedOut ? " · timed out" : ""}`,
      item,
    })), { title: "本地 Agent 尝试记录" });
    if (!selected) return;
    let item = selected.item;
    const actions = [
      { label: "打开尝试记录", id: "open" },
      { label: "记录测试命令和结果（手工提供）", id: "tests" },
      ...(["unknown", "awaiting_confirmation"].includes(item.state)
        ? [{ label: "确认 Agent 已结束（结果仍需核验）", id: "ended" }]
        : []),
    ];
    const action = await vscode.window.showQuickPick(actions, { title: `Agent 尝试 ${item.id.slice(0, 8)}` });
    if (!action) return;
    if (action.id === "tests") {
      const testEvidence = await vscode.window.showInputBox({
        title: "记录测试证据",
        prompt: "填写你实际运行的命令及结果；此记录由用户提供，扩展不会替你验证。",
        value: item.testEvidence ?? "",
        placeHolder: "例如：npm test — 76 passed（由我本地运行）",
        ignoreFocusOut: true,
      });
      if (testEvidence === undefined) return;
      item = await store.update(item.id, { testEvidence: testEvidence.trim() || null });
      void vscode.window.showInformationMessage("测试说明已保存在本机尝试记录中。");
      return;
    }
    if (action.id === "ended") {
      if (item.pid !== null && item.pid !== undefined && isRunningProcess(item.pid)) {
        void vscode.window.showWarningMessage("Agent 进程仍在运行；请等它结束后再确认。");
        return;
      }
      const confirmed = await vscode.window.showWarningMessage(
        "请先在系统进程列表或终端确认此 Agent 已退出。记录将标为“已确认结束，结果未核验”，不会代表任务完成或测试通过。",
        { modal: true }, "我已确认进程结束",
      );
      if (confirmed !== "我已确认进程结束") return;
      await store.update(item.id, { state: "ended_unverified" });
      await store.releaseWorkdirLease(item.workdir, item.id);
      void vscode.window.showInformationMessage("已记录 Agent 结束；工作目录可用于下一次尝试。结果和测试仍需人工核验。");
      return;
    }
    const document = await vscode.workspace.openTextDocument({ language: "json", content: JSON.stringify({
      id: item.id, checkpointId: item.checkpointId, projectId: item.projectId, taskId: item.taskId,
      attemptKind: item.attemptKind, mode: item.mode, provider: item.provider, providerSessionId: item.providerSessionId,
      state: item.state, startedAt: item.startedAt, updatedAt: item.updatedAt,
      workdir: item.workdir, branch: item.branch, baseSha: item.baseSha, parentAttemptId: item.parentAttemptId,
      pid: item.pid, hostPid: item.hostPid, exitCode: item.exitCode, timedOut: item.timedOut,
      agentSummary: item.agentSummary, completionHeadSha: item.completionHeadSha,
      completionDirty: item.completionDirty, userReportedTestEvidence: item.testEvidence,
    }, null, 2) });
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "读取本地 Agent 尝试失败"); }
}

async function readFreshInput(context: vscode.ExtensionContext, binding: WorkspaceBinding, workspacePath: string, checkpoint: WorkCheckpoint): Promise<{
  workspaceTrusted: boolean;
  projectId: string;
  checkpoint: WorkCheckpoint;
  task: Awaited<ReturnType<ReturnType<typeof createWorkspaceApi>["getTask"]>> | null;
  taskAccessible: boolean;
  repository: RepositorySnapshot | null;
  checkpointCommitAvailable: boolean;
}> {
  let task = null;
  let taskAccessible = false;
  try {
    task = await createWorkspaceApi(context, binding).getTask(checkpoint.taskId);
    taskAccessible = task.id === checkpoint.taskId && task.projectId === binding.projectId;
  } catch { /* Fail closed below with a concrete inaccessible-task blocker. */ }
  let repository: RepositorySnapshot | null = null;
  let checkpointCommitAvailable = false;
  try {
    const localId = await getLocalOnlyRepositoryId(context, binding.workspaceUri);
    repository = await readRepositorySnapshot(workspacePath, localId);
    checkpointCommitAvailable = await hasCommit(repository.rootPath, checkpoint.repository.headSha);
  } catch { /* Fail closed below with a concrete repository blocker. */ }
  return { workspaceTrusted: vscode.workspace.isTrusted, projectId: binding.projectId, checkpoint, task, taskAccessible, repository, checkpointCommitAvailable };
}

async function showTaskChanges(checkpoint: WorkCheckpoint, result: Extract<PreflightResult, { status: "needs-confirmation" }>): Promise<void> {
  const content = [
    `# ${checkpoint.taskSnapshot.title}`, "", "确认按当前服务端任务要求继续；原检查点不会被改写。", "",
    ...result.changes.flatMap((change) => [`## ${change.field}`, `检查点记录：${change.saved}`, `当前任务：${change.current}`, ""]),
  ].join("\n");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content }), { preview: true });
}

async function showBlockers(blockers: string[]): Promise<void> {
  const content = [`# 接续未启动`, "", ...blockers.map((item) => `- ${item}`)].join("\n");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content }), { preview: true });
  void vscode.window.showWarningMessage(`接续被阻止：${blockers[0] ?? "状态已变化"}`);
}

function samePreflightSnapshot(before: Extract<PreflightResult, { status: "ready" }>, after: PreflightResult): boolean {
  if (after.status !== "ready") return false;
  return before.plan.baseSha === after.plan.baseSha && before.plan.projectId === after.plan.projectId &&
    before.plan.taskId === after.plan.taskId && before.plan.handoffVersion === after.plan.handoffVersion &&
    before.plan.taskUpdatedAt === after.plan.taskUpdatedAt && before.plan.targetDirectory === after.plan.targetDirectory &&
    before.plan.repositoryKey === after.plan.repositoryKey && before.plan.taskFingerprint === after.plan.taskFingerprint;
}
