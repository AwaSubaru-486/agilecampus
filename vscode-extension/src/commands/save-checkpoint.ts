import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { mayUseOfflineTaskSnapshot } from "./checkpoint-offline-policy";
import { EntireAdapter } from "../adapters/entire-adapter";
import { CheckpointStore } from "../checkpoints/store";
import type { WorkCheckpoint, NewCheckpointArtifact } from "../checkpoints/types";
import { readRepositorySnapshot, sameRepositorySnapshot } from "../git/repository-service";
import type { TaskDetail } from "../types";
import { createWorkspaceApi, getLocalOnlyRepositoryId, promptText, selectBoundWorkspace, splitItems } from "./checkpoint-support";

export function registerSaveCheckpointCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.saveCheckpoint", () => saveCheckpoint(context)));
}

async function saveCheckpoint(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage("此操作需要先信任当前 VS Code 工作区。");
    return;
  }
  const selectedWorkspace = await selectBoundWorkspace(context);
  if (!selectedWorkspace) return;
  const { folder, binding } = selectedWorkspace;
  const api = createWorkspaceApi(context, binding);
  const store = new CheckpointStore(context.globalStorageUri.fsPath);
  let tasks: Awaited<ReturnType<typeof api.listTasks>> = [];
  let pickedTask: { task: { id: string; title: string; status: string; assigneeName: string | null } } | undefined;
  let task: TaskDetail | undefined;
  let usingOfflineSnapshot = false;
  try {
    tasks = await api.listTasks(binding.projectId);
  } catch (error) {
    if (!mayUseOfflineTaskSnapshot(error)) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取项目任务");
      return;
    }
    const local = await store.list(binding.serverOrigin, binding.projectId).catch(() => []);
    if (!local.length) {
      void vscode.window.showErrorMessage(`${error instanceof Error ? error.message : "无法读取项目任务"}；尚无本地检查点可用作离线任务基线。`);
      return;
    }
    const previous = await vscode.window.showQuickPick(local.map(({ manifest }) => ({
      label: manifest.taskSnapshot.title,
      description: `${manifest.repository.headSha.slice(0, 10)} · 本地快照 ${new Date(manifest.capturedAt).toLocaleString()}`,
      manifest,
    })), { title: "离线保存：选择已有任务基线" });
    if (!previous) return;
    const useOffline = await vscode.window.showWarningMessage(
      `服务端暂不可用。将使用 ${new Date(previous.manifest.taskUpdatedAt).toLocaleString()} 的任务契约快照；新检查点仅保存在本机，恢复连接后发布前必须重新核对版本。`,
      { modal: true }, "继续离线保存",
    );
    if (useOffline !== "继续离线保存") return;
    const snapshot = previous.manifest.taskSnapshot;
    task = {
      id: previous.manifest.taskId,
      projectId: previous.manifest.projectId,
      title: snapshot.title,
      status: snapshot.status,
      priority: snapshot.priority,
      dueDate: snapshot.dueDate,
      assigneeId: snapshot.assigneeId,
      assigneeName: snapshot.assigneeName,
      handoffBrief: snapshot.handoffBrief,
      doneCriteria: snapshot.doneCriteria,
      requiredEvidence: snapshot.requiredEvidence,
      updatedAt: previous.manifest.taskUpdatedAt,
      description: snapshot.description,
      completionNote: snapshot.completionNote,
      responseDueAt: snapshot.responseDueAt,
      handoffVersion: previous.manifest.handoffVersion,
      committedHandoffVersion: snapshot.committedHandoffVersion,
    };
    pickedTask = { task: { id: task.id, title: task.title, status: task.status, assigneeName: task.assigneeName } };
    usingOfflineSnapshot = true;
  }
  if (!pickedTask) {
    if (!tasks.length) {
      void vscode.window.showInformationMessage("此项目没有可关联的任务。");
      return;
    }
    const onlineChoice = await vscode.window.showQuickPick(tasks.map((item) => ({
      label: item.title,
      description: `${item.status} · ${item.assigneeName ?? "未分配"}`,
      task: item,
    })), { title: "选择检查点关联任务" });
    if (!onlineChoice) return;
    pickedTask = onlineChoice;
    try { task = await api.getTask(pickedTask.task.id); }
    catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取任务要求"); return; }
  }
  if (!pickedTask || !task) {
    void vscode.window.showErrorMessage("未能取得有效任务快照，检查点未保存。");
    return;
  }
  if (task.projectId !== binding.projectId || task.id !== pickedTask.task.id) {
    void vscode.window.showErrorMessage("任务与当前项目不匹配，未保存检查点。");
    return;
  }
  if (!task.updatedAt || !Number.isInteger(task.handoffVersion) || task.handoffVersion < 1) {
    void vscode.window.showErrorMessage("任务缺少可验证的交接版本或更新时间，未保存检查点。");
    return;
  }

  const localOnlyId = await getLocalOnlyRepositoryId(context, folder.uri.toString());
  let before;
  try { before = await readRepositorySnapshot(folder.uri.fsPath, localOnlyId); }
  catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取 Git 状态"); return; }
  if (before.dirty) {
    const choice = await vscode.window.showWarningMessage(
      "工作区有未提交或未跟踪改动。此检查点只记录 HEAD；这些改动不会被保存或带给队友。",
      { modal: true }, "继续并排除改动",
    );
    if (choice !== "继续并排除改动") return;
  }
  if (before.recoveryBlockers.length) {
    void vscode.window.showWarningMessage(`此 Git 仓库包含暂不支持恢复的内容：${before.recoveryBlockers.join(" ")}检查点仍会标记为不可原生恢复。`);
  }

  const goal = await promptText("检查点交接", "本次工作的目标", true);
  if (goal === undefined) return;
  const completed = await promptText("检查点交接", "已完成事项；多项用顿号或分号分隔", false);
  if (completed === undefined) return;
  const remaining = await promptText("检查点交接", "未完成事项；多项用顿号或分号分隔", false);
  if (remaining === undefined) return;
  const blocker = await promptText("检查点交接", "当前阻塞；没有可留空", false);
  if (blocker === undefined) return;
  const rejectedApproaches = await promptText("检查点交接", "已尝试但放弃的方案；没有可留空", false);
  if (rejectedApproaches === undefined) return;
  const nextAction = await promptText("检查点交接", "下一步明确动作", true);
  if (nextAction === undefined) return;

  const adapter = new EntireAdapter();
  const capability = await adapter.inspectCapabilities(folder.uri.fsPath);
  const nativeCaptureReady = capability.status === "ok" && capability.value.capabilities.capture === "verified";
  const sessions = nativeCaptureReady ? await adapter.listSessions(folder.uri.fsPath) : { status: "unsupported" as const, reason: "Entire session capture is unavailable" };
  const sessionChoices: Array<{ label: string; description: string; sessionId: string | null }> = [
    { label: "仅保存交接和 Git 基线", description: "不附加会话原文；保存为 context-only", sessionId: null },
  ];
  if (sessions.status === "ok") {
    for (const session of sessions.value) {
      sessionChoices.push({
        label: `附加本机会话文本：${session.sessionId.slice(0, 8)}`,
        description: `${session.status} · ${session.model ?? "未知模型"} · 最新 Entire checkpoint ${session.lastCheckpointId ?? "无"}`,
        sessionId: session.sessionId,
      });
    }
  }
  const pickedSession = await vscode.window.showQuickPick(sessionChoices, { title: "检查点包含的 Agent 材料", placeHolder: "原始会话可能包含完整提示词和工具输入输出" });
  if (!pickedSession) return;
  const artifacts: NewCheckpointArtifact[] = [];
  let sessionInfo: WorkCheckpoint["session"] = {
    provider: "Entire CLI",
    providerVersion: capability.status === "ok" ? capability.value.cliVersion : "unavailable",
    sessionId: null,
    checkpointId: null,
    captureMode: "context-only",
  };
  if (pickedSession.sessionId) {
    const consent = await vscode.window.showWarningMessage(
      "将把该会话的原始 transcript 保存到此电脑的 VS Code 全局存储中。内容可能包含提示词、模型回复和工具输入输出；它不能被当作可原生恢复的断点。",
      { modal: true }, "保存会话文本副本",
    );
    if (consent !== "保存会话文本副本") return;
    const captured = await adapter.capture(folder.uri.fsPath, pickedSession.sessionId);
    if (captured.status !== "ok") {
      void vscode.window.showErrorMessage(captured.reason);
      return;
    }
    const changedDuringCapture = sessions.status === "ok" && sessions.value
      .find((item) => item.sessionId === pickedSession.sessionId)
      ?.turns !== captured.value.session.turns;
    if (changedDuringCapture) {
      void vscode.window.showWarningMessage("会话在选择后发生变化；为避免保存点不一致，请重新开始保存。");
      return;
    }
    sessionInfo = {
      provider: "Entire CLI",
      providerVersion: capability.status === "ok" ? capability.value.cliVersion : "unknown",
      sessionId: captured.value.session.sessionId,
      checkpointId: captured.value.session.lastCheckpointId,
      captureMode: "context-only",
    };
    artifacts.push({ kind: "transcript", content: Buffer.from(captured.value.transcript, "utf8") });
  }

  if (!usingOfflineSnapshot) {
    try {
      const latestTask = await api.getTask(task.id);
      if (latestTask.projectId !== binding.projectId || latestTask.updatedAt !== task.updatedAt || latestTask.handoffVersion !== task.handoffVersion) {
        void vscode.window.showWarningMessage("任务要求在保存期间发生变化；检查点未保存，请重新核对后再试。");
        return;
      }
    } catch (error) {
      if (!mayUseOfflineTaskSnapshot(error)) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法刷新任务");
        return;
      }
      const proceed = await vscode.window.showWarningMessage(
        `${error instanceof Error ? error.message : "无法刷新任务"}。任务快照在本次填写前已读取；可以仅保存在本机，稍后发布前再核对。`,
        { modal: true }, "仅本地保存",
      );
      if (proceed !== "仅本地保存") return;
    }
  }
  try {
    const after = await readRepositorySnapshot(folder.uri.fsPath, localOnlyId);
    if (!sameRepositorySnapshot(before, after)) {
      void vscode.window.showWarningMessage("Git 基线在填写交接内容期间发生变化；检查点未保存，请重新捕获。");
      return;
    }
    const manifest: WorkCheckpoint = {
      schemaVersion: 1,
      id: randomUUID(),
      parentCheckpointId: null,
      serverOrigin: binding.serverOrigin,
      projectId: binding.projectId,
      taskId: task.id,
      milestoneId: null,
      capturedAt: new Date().toISOString(),
      handoffVersion: task.handoffVersion,
      taskUpdatedAt: task.updatedAt,
      taskSnapshot: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        assigneeId: task.assigneeId,
        assigneeName: task.assigneeName,
        description: task.description,
        handoffBrief: task.handoffBrief,
        doneCriteria: task.doneCriteria,
        requiredEvidence: task.requiredEvidence,
        responseDueAt: task.responseDueAt,
        completionNote: task.completionNote,
        committedHandoffVersion: task.committedHandoffVersion,
      },
      repository: {
        key: before.key,
        headSha: before.headSha,
        branch: before.branch,
        dirty: before.dirty,
        dirtyPolicy: before.dirty ? "excluded" : "clean-only",
        recoveryBlockers: before.recoveryBlockers,
      },
      session: sessionInfo,
      handoff: {
        goal: goal.trim(),
        completed: splitItems(completed),
        remaining: splitItems(remaining),
        blocker: blocker.trim() || null,
        rejectedApproaches: splitItems(rejectedApproaches),
        nextAction: nextAction.trim(),
      },
      tests: [],
      artifacts: [],
    };
    await store.save(manifest, artifacts);
    const dirtyNote = before.dirty ? "；未提交修改已排除" : "";
    const blockerNote = before.recoveryBlockers.length ? "；包含暂不支持恢复的仓库材料" : "";
    const offlineNote = usingOfflineSnapshot ? "；使用历史任务快照，发布前需核对版本" : "";
    void vscode.window.showInformationMessage(`本地检查点已保存（${before.headSha.slice(0, 10)}）${dirtyNote}${blockerNote}${offlineNote}。当前保存的是 context-only 交接材料。`);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "检查点保存失败");
  }
}
