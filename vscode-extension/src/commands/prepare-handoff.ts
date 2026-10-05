import * as vscode from "vscode";
import { CheckpointStore } from "../checkpoints/store";
import type { WorkCheckpoint } from "../checkpoints/types";
import { evaluateHandoffPreflight, type PreflightResult, type TaskRequirementChange } from "../handoff/preflight";
import { hasCommit, readRepositorySnapshot } from "../git/repository-service";
import { createWorkspaceApi, getLocalOnlyRepositoryId, selectBoundWorkspace } from "./checkpoint-support";

export function registerPrepareHandoffCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.prepareHandoff", () => prepareHandoff(context)));
}

async function prepareHandoff(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage("准备接续需要先信任当前 VS Code 工作区。"); return; }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const { folder, binding } = selected;
  const store = new CheckpointStore(context.globalStorageUri.fsPath);
  try {
    const records = await store.list(binding.serverOrigin, binding.projectId);
    if (!records.length) { void vscode.window.showInformationMessage("当前项目还没有可用的本地检查点。"); return; }
    const choice = await vscode.window.showQuickPick(records.map(({ manifest }) => ({
      label: manifest.handoff.goal,
      description: `${manifest.repository.headSha.slice(0, 10)} · ${new Date(manifest.capturedAt).toLocaleString()}`,
      detail: `${manifest.taskSnapshot.title} · ${manifest.session.captureMode}`,
      id: manifest.id,
    })), { title: "选择接续起点" });
    if (!choice) return;
    const checkpoint = await store.read(binding.serverOrigin, binding.projectId, choice.id);
    if (!checkpoint) throw new Error("检查点已不存在");

    let task = null;
    let taskAccessible = false;
    try {
      task = await createWorkspaceApi(context, binding).getTask(checkpoint.taskId);
      taskAccessible = task.id === checkpoint.taskId && task.projectId === binding.projectId;
    } catch { /* The preflight reports a concrete blocked state without changing local material. */ }
    let repository = null;
    let checkpointCommitAvailable = false;
    try {
      const localOnlyId = await getLocalOnlyRepositoryId(context, folder.uri.toString());
      repository = await readRepositorySnapshot(folder.uri.fsPath, localOnlyId);
      checkpointCommitAvailable = await hasCommit(repository.rootPath, checkpoint.repository.headSha);
    } catch { /* The preflight reports the repository as unavailable. */ }
    const input = {
      workspaceTrusted: vscode.workspace.isTrusted,
      projectId: binding.projectId,
      checkpoint,
      task,
      taskAccessible,
      repository,
      materialSummary: checkpoint.artifacts.map(({ kind, byteLength }) => ({ kind, byteLength })),
      checkpointCommitAvailable,
      confirmedChangedTask: false,
    };
    let result = evaluateHandoffPreflight(input);
    if (result.status === "blocked") {
      await showPreflight("接续条件未通过", result.blockers);
      return;
    }
    if (result.status === "needs-confirmation") {
      await showTaskChanges(checkpoint, result);
      const consent = await vscode.window.showWarningMessage(
        "任务要求或负责人已变化。原检查点保持不变；确认后本次接续计划采用当前服务端任务要求。",
        { modal: true }, "按当前要求继续准备",
      );
      if (consent !== "按当前要求继续准备") return;
      result = evaluateHandoffPreflight({ ...input, confirmedChangedTask: true });
    }
    if (result.status !== "ready") {
      await showPreflight("接续条件未通过", result.status === "blocked" ? result.blockers : ["任务变化尚未得到确认。"]);
      return;
    }
    await showPlan(checkpoint, result);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "准备接续失败");
  }
}

async function showTaskChanges(checkpoint: WorkCheckpoint, result: Extract<PreflightResult, { status: "needs-confirmation" }>): Promise<void> {
  const lines = [
    `# ${checkpoint.taskSnapshot.title}`,
    "",
    `检查点版本：${checkpoint.handoffVersion} · ${checkpoint.taskUpdatedAt}`,
    "",
    ...formatChanges(result.changes),
  ];
  const document = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function showPlan(checkpoint: WorkCheckpoint, result: Extract<PreflightResult, { status: "ready" }>): Promise<void> {
  const lines = [
    `# 接续计划：${checkpoint.handoff.goal}`,
    "",
    `模式：${result.plan.mode}；不恢复 Entire 原生 session` ,
    `任务：${checkpoint.taskSnapshot.title} (${result.plan.taskId})`,
    `基线：${result.plan.baseSha}`,
    `分支：${result.plan.branch ?? "detached HEAD"}`,
    `目标目录：${result.plan.targetDirectory}`,
    `接续进程：Codex CLI ${checkpoint.session.providerVersion}（E07 运行时还会核对 CLI 版本）`,
    `权限：用户确认后，仅对目标工作区开放 workspace-write；不会使用全盘权限，不会执行检查点携带的命令。`,
    `材料：${result.plan.materials.length ? result.plan.materials.map(({ kind, bytes }) => `${kind} (${bytes} bytes)`).join("、") : "仅任务交接字段；无附件"}`,
    `任务版本：${result.plan.handoffVersion} · ${result.plan.taskUpdatedAt}`,
    `会话：${checkpoint.session.sessionId ?? "未附加"}`,
    "",
    "任务要求的验收证据（接续 Agent 不能自行标记任务完成）：",
    ...(result.plan.evidenceRequirements.length ? result.plan.evidenceRequirements.map((item) => `- ${item}`) : ["- 未填写"]),
    "",
    "本步骤只检查和展示材料；不会启动 Agent、checkout、stage、commit 或改动共享任务。",
    "",
    ...result.warnings.map((warning) => `限制：${warning}`),
  ];
  const document = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") });
  await vscode.window.showTextDocument(document, { preview: true });
  void vscode.window.showInformationMessage("接续前检查通过；Agent 尚未启动。后续执行必须再次确认并重新检查。" );
}

async function showPreflight(title: string, blockers: string[]): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: [`# ${title}`, "", ...blockers.map((item) => `- ${item}`)].join("\n"),
  });
  await vscode.window.showTextDocument(document, { preview: true });
  void vscode.window.showErrorMessage(`${title}：${blockers[0] ?? "请检查状态"}`);
}

function formatChanges(changes: TaskRequirementChange[]): string[] {
  return changes.flatMap((change) => [
    `## ${change.field}`,
    `检查点记录：${change.saved}`,
    `当前任务：${change.current}`,
    "",
  ]);
}
