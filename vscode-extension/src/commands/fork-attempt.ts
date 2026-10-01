import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { AttemptStore } from "../attempts/store";
import { CheckpointStore } from "../checkpoints/store";
import type { WorkCheckpoint } from "../checkpoints/types";
import { evaluateHandoffPreflight, type PreflightResult } from "../handoff/preflight";
import { createCheckpointWorktree, resolveAttemptWorktreeLocation } from "../git/worktree-service";
import { hasCommit, readRepositorySnapshot } from "../git/repository-service";
import { createWorkspaceApi, getLocalOnlyRepositoryId, selectBoundWorkspace } from "./checkpoint-support";

export function registerForkAttemptCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.forkAttempt", () => forkAttempt(context)));
}

async function forkAttempt(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage("创建并行尝试需要先信任当前 VS Code 工作区。"); return; }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const { folder, binding } = selected;
  const checkpoints = new CheckpointStore(context.globalStorageUri.fsPath);
  const attempts = new AttemptStore(context.globalStorageUri.fsPath);
  try {
    const records = await checkpoints.list(binding.serverOrigin, binding.projectId);
    if (!records.length) { void vscode.window.showInformationMessage("当前项目没有可用于并行尝试的本地检查点。"); return; }
    const choice = await vscode.window.showQuickPick(records.map(({ manifest }) => ({
      label: manifest.handoff.goal,
      description: `${manifest.repository.headSha.slice(0, 10)} · ${new Date(manifest.capturedAt).toLocaleString()}`,
      detail: manifest.taskSnapshot.title,
      id: manifest.id,
    })), { title: "选择共同起点" });
    if (!choice) return;
    const checkpoint = await checkpoints.read(binding.serverOrigin, binding.projectId, choice.id);
    if (!checkpoint) throw new Error("检查点已不存在");
    if (checkpoint.repository.dirty || checkpoint.repository.dirtyPolicy !== "clean-only") {
      void vscode.window.showErrorMessage("并行方案要求检查点来自 clean-only 基线；被排除的未提交改动不能带入 A/B 尝试。");
      return;
    }
    if (checkpoint.repository.recoveryBlockers.length) {
      void vscode.window.showErrorMessage(`检查点包含不支持的恢复内容：${checkpoint.repository.recoveryBlockers.join(" ")}`);
      return;
    }

    let initial = await readPreflight(context, binding, folder.uri.fsPath, checkpoint);
    let preflight = evaluateHandoffPreflight({ ...initial, materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })), confirmedChangedTask: false, requireHeadMatch: false });
    if (preflight.status === "blocked") { await showBlockers(preflight.blockers); return; }
    if (preflight.status === "needs-confirmation") {
      await showTaskChanges(checkpoint, preflight);
      const choice = await vscode.window.showWarningMessage("任务要求或负责人已变化。新 worktree 会从检查点 SHA 建立；确认后 Agent 按当前服务端任务要求继续。", { modal: true }, "按当前要求继续");
      if (choice !== "按当前要求继续") return;
      preflight = evaluateHandoffPreflight({ ...initial, materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })), confirmedChangedTask: true, requireHeadMatch: false });
    }
    if (preflight.status !== "ready") { await showBlockers(["接续预检未通过。"]); return; }

    const [parentUri] = await vscode.window.showOpenDialog({
      title: "选择专用 worktree 父目录",
      openLabel: "选择父目录",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    }) ?? [];
    if (!parentUri) return;
    const attemptId = randomUUID();
    const location = await resolveAttemptWorktreeLocation(parentUri.fsPath, attemptId);
    const consent = await vscode.window.showWarningMessage(
      `将从精确 SHA ${checkpoint.repository.headSha} 创建独立 worktree。\n分支：${location.branch}\n目录：${location.path}\n不会复制 dirty 文件、运行安装脚本、启动 Agent 或合并更改。worktree 不是操作系统安全沙箱。`,
      { modal: true }, "创建并行尝试",
    );
    if (consent !== "创建并行尝试") return;

    const latest = await readPreflight(context, binding, folder.uri.fsPath, checkpoint);
    const finalPreflight = evaluateHandoffPreflight({ ...latest, materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })), confirmedChangedTask: true, requireHeadMatch: false });
    if (finalPreflight.status !== "ready" || !samePreflight(preflight, finalPreflight)) {
      await showBlockers(finalPreflight.status === "blocked" ? finalPreflight.blockers : ["确认期间任务或源工作区状态变化；未创建 worktree，请重新预检。"]);
      return;
    }

    const attempt = await attempts.create({
      checkpointId: checkpoint.id, projectId: checkpoint.projectId, taskId: checkpoint.taskId,
      attemptKind: "parallel", mode: "context-only", provider: "codex-cli", providerSessionId: null,
      state: "preparing", workdir: location.path, branch: location.branch,
      baseSha: checkpoint.repository.headSha, parentAttemptId: null, pid: null, exitCode: null, timedOut: false,
    }, attemptId);
    try {
      const worktree = await createCheckpointWorktree({
        workspacePath: folder.uri.fsPath,
        parentDirectory: parentUri.fsPath,
        localRepositoryId: await getLocalOnlyRepositoryId(context, binding.workspaceUri),
        checkpointRepositoryKey: checkpoint.repository.key,
        checkpointSha: checkpoint.repository.headSha,
        attemptId,
        recoveryBlockers: checkpoint.repository.recoveryBlockers,
      });
      await attempts.update(attempt.id, { state: "prepared", workdir: worktree.path, branch: worktree.branch, baseSha: worktree.baseSha });
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      if (!workspaceFolders.some((entry) => entry.uri.fsPath === worktree.path)) {
        vscode.workspace.updateWorkspaceFolders(workspaceFolders.length, 0, {
          uri: vscode.Uri.file(worktree.path), name: `Agent 尝试 ${attempt.id.slice(0, 8)}`,
        });
      }
      void vscode.window.showInformationMessage(`并行尝试已准备：${worktree.branch}，基线 ${worktree.baseSha.slice(0, 10)}。使用“从检查点启动 Agent”并选择此 worktree 开始工作。`);
    } catch (error) {
      await attempts.update(attempt.id, { state: "failed" });
      throw error;
    }
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "创建并行尝试失败");
  }
}

async function readPreflight(context: vscode.ExtensionContext, binding: { serverOrigin: string; workspaceUri: string; projectId: string }, workspacePath: string, checkpoint: WorkCheckpoint) {
  let task = null;
  let taskAccessible = false;
  try {
    task = await createWorkspaceApi(context, binding).getTask(checkpoint.taskId);
    taskAccessible = task.projectId === binding.projectId && task.id === checkpoint.taskId;
  } catch { /* Preflight reports inaccessible task and fails closed. */ }
  let repository = null;
  let checkpointCommitAvailable = false;
  try {
    repository = await readRepositorySnapshot(workspacePath, await getLocalOnlyRepositoryId(context, binding.workspaceUri));
    checkpointCommitAvailable = await hasCommit(repository.rootPath, checkpoint.repository.headSha);
  } catch { /* Preflight reports an unavailable repository and fails closed. */ }
  return { workspaceTrusted: vscode.workspace.isTrusted, projectId: binding.projectId, checkpoint, task, taskAccessible, repository, checkpointCommitAvailable };
}

async function showTaskChanges(checkpoint: WorkCheckpoint, result: Extract<PreflightResult, { status: "needs-confirmation" }>): Promise<void> {
  const content = [`# ${checkpoint.taskSnapshot.title}`, "", "检查点的不可变任务快照与当前任务差异：", "", ...result.changes.flatMap((item) => [
    `## ${item.field}`, `检查点：${item.saved}`, `当前：${item.current}`, "",
  ])].join("\n");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content }), { preview: true });
}

async function showBlockers(blockers: string[]): Promise<void> {
  const content = [`# 并行尝试未创建`, "", ...blockers.map((item) => `- ${item}`)].join("\n");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content }), { preview: true });
  void vscode.window.showWarningMessage(`无法创建尝试：${blockers[0] ?? "状态已变化"}`);
}

function samePreflight(before: Extract<PreflightResult, { status: "ready" }>, after: PreflightResult): boolean {
  return after.status === "ready" && before.plan.taskFingerprint === after.plan.taskFingerprint &&
    before.plan.repositoryKey === after.plan.repositoryKey && before.plan.baseSha === after.plan.baseSha &&
    before.plan.targetDirectory === after.plan.targetDirectory;
}
