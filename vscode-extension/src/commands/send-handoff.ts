import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { ApiError, type CreateHandoffPayload, type ServerHandoff } from "../agilecampus/api-client";
import { fullCheckpointMatches, toCheckpointIndexPayload } from "../checkpoints/index-payload";
import { HandoffMappingStore, type HandoffOperationMapping } from "../checkpoints/handoff-mapping";
import { stableIdempotencyKey } from "../checkpoints/idempotency";
import { ServerCheckpointMappingStore } from "../checkpoints/server-mapping";
import { CheckpointStore } from "../checkpoints/store";
import { createWorkspaceApi, selectBoundWorkspace } from "./checkpoint-support";
import { canReissueHandoff, recipientCanReadCheckpoint } from "./handoff-policy";
import { runConfirmedHandoff } from "./handoff-send-flow";

export function registerSendHandoffCommand(context: vscode.ExtensionContext): void {
  let inFlight = false;
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.sendHandoff", async () => {
    if (inFlight) {
      void vscode.window.showInformationMessage("交接请求正在处理，请等待当前请求完成。");
      return;
    }
    inFlight = true;
    try { await sendHandoff(context); }
    finally { inFlight = false; }
  }));
}

async function sendHandoff(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage("此操作需要先信任当前 VS Code 工作区。");
    return;
  }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const { binding } = selected;
  const api = createWorkspaceApi(context, binding);
  const serverOrigin = api.baseUrl.toString();
  let actor;
  let members;
  try {
    [actor, members] = await Promise.all([api.getCurrentActor(), api.listProjectHandoffMembers(binding.projectId)]);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取当前项目成员");
    return;
  }
  const eligibleMembers = members.filter((member) => member.userId !== actor.id);
  if (!eligibleMembers.length) {
    void vscode.window.showInformationMessage("当前项目没有可选择的其他成员。");
    return;
  }

  const local = await new CheckpointStore(context.globalStorageUri.fsPath)
    .list(binding.serverOrigin, binding.projectId)
    .catch((error: unknown) => {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取本地检查点");
      return [];
    });
  const checkpointMappings = new ServerCheckpointMappingStore(context.workspaceState);
  const mappedCheckpoints = local.flatMap(({ manifest }) => {
    const mapping = checkpointMappings.get(serverOrigin, binding.projectId, manifest.taskId, manifest.id);
    return mapping ? [{ manifest, mapping }] : [];
  });
  if (!mappedCheckpoints.length) {
    void vscode.window.showInformationMessage("没有已发布并映射到服务端的本地检查点。请先保存并发布检查点摘要。");
    return;
  }
  const pickedCheckpoint = await vscode.window.showQuickPick(mappedCheckpoints.map((item) => ({
    label: item.manifest.handoff.goal,
    description: `${item.manifest.taskSnapshot.title} · ${item.manifest.repository.headSha.slice(0, 10)}`,
    detail: `契约 v${item.manifest.handoffVersion} · 服务端检查点 ${item.mapping.serverCheckpointId}`,
    item,
  })), { title: "选择已发布的检查点作为交接基线" });
  if (!pickedCheckpoint) return;
  const { manifest, mapping: checkpointMapping } = pickedCheckpoint.item;
  const parentMapping = manifest.parentCheckpointId
    ? checkpointMappings.get(serverOrigin, binding.projectId, manifest.taskId, manifest.parentCheckpointId)
    : null;
  if (manifest.parentCheckpointId && !parentMapping) {
    void vscode.window.showErrorMessage("本地检查点的父级尚未映射到服务端；未发起交接。");
    return;
  }

  let remoteCheckpoint;
  try {
    remoteCheckpoint = await api.getCheckpointIndex(checkpointMapping.serverCheckpointId);
  } catch (error) {
    void vscode.window.showErrorMessage(`无法核对已发布检查点；未发起交接。${error instanceof Error ? ` ${error.message}` : ""}`);
    return;
  }
  if (
    remoteCheckpoint.id !== checkpointMapping.serverCheckpointId || remoteCheckpoint.creatorId !== actor.id ||
    !fullCheckpointMatches(remoteCheckpoint, binding.projectId, manifest.taskId, toCheckpointIndexPayload(manifest, remoteCheckpoint.visibility, parentMapping?.serverCheckpointId ?? null))
  ) {
    void vscode.window.showErrorMessage("服务端检查点与本地检查点不一致，或并非由当前账号发布；未发起交接。");
    return;
  }

  const pickedMember = await vscode.window.showQuickPick(eligibleMembers.map((member) => ({
    label: member.displayName,
    description: member.role,
    member,
  })), { title: "选择接收成员", placeHolder: "只显示当前项目有效成员" });
  if (!pickedMember) return;
  const member = pickedMember.member;
  const handoffMappings = new HandoffMappingStore(context.workspaceState);
  let operation = handoffMappings.get(serverOrigin, binding.projectId, manifest.taskId, manifest.id, member.userId);
  if (operation && operation.serverCheckpointId !== checkpointMapping.serverCheckpointId) {
    void vscode.window.showErrorMessage("待重试交接绑定的服务端检查点已变化；为避免复用错误幂等请求，未发送。");
    return;
  }
  let reofferState: ServerHandoff["state"] | null = null;
  if (operation?.handoffId) {
    let previous: ServerHandoff;
    try { previous = await api.getHandoff(operation.handoffId); }
    catch (error) {
      void vscode.window.showErrorMessage(`无法核对已有交接状态；为避免重复创建，未发起新交接。${error instanceof Error ? ` ${error.message}` : ""}`);
      return;
    }
    if (
      previous.id !== operation.handoffId || previous.projectId !== binding.projectId || previous.taskId !== manifest.taskId ||
      previous.checkpointId !== checkpointMapping.serverCheckpointId || previous.fromUserId !== actor.id ||
      previous.toUserId !== member.userId || previous.idempotencyKey !== operation.idempotencyKey ||
      previous.expectedTaskUpdatedAt !== operation.expectedTaskUpdatedAt ||
      previous.expectedHandoffVersion !== operation.expectedHandoffVersion
    ) {
      void vscode.window.showErrorMessage("本地交接记录与服务端记录不一致；为避免错误重发，未创建新交接。");
      return;
    }
    if (!canReissueHandoff(previous.state)) {
      void vscode.window.showInformationMessage(`此检查点已有交接记录，服务端状态：${previous.state}（${previous.id}）。该状态不允许再次发起。`);
      return;
    }
    reofferState = previous.state;
    operation = undefined;
  }
  const isRetry = Boolean(operation);

  let currentTask;
  try {
    currentTask = await api.getTask(manifest.taskId);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法刷新任务契约；未发起交接");
    return;
  }
  if (currentTask.id !== manifest.taskId || currentTask.projectId !== binding.projectId) {
    void vscode.window.showErrorMessage("刷新到的任务与当前项目不匹配；未发起交接。");
    return;
  }
  let currentMember;
  try {
    currentMember = (await api.listProjectHandoffMembers(binding.projectId)).find((item) => item.userId === member.userId);
  } catch (error) {
    void vscode.window.showErrorMessage(`无法刷新接收成员资格；未发起交接。${error instanceof Error ? ` ${error.message}` : ""}`);
    return;
  }
  if (!currentMember) {
    void vscode.window.showWarningMessage("该接收人已不在当前项目成员列表中；未发起交接。");
    return;
  }
  if (!recipientCanReadCheckpoint(remoteCheckpoint.visibility, currentMember, currentTask.assigneeId)) {
    void vscode.window.showWarningMessage(
      "此检查点仅对创建者、当前任务负责人和管理员开放。所选成员无读取权限；请以“项目成员可见”重新发布检查点，或经正常流程改派任务后重试。",
    );
    return;
  }

  let payload: CreateHandoffPayload;
  if (operation) {
    const retry = await vscode.window.showWarningMessage(
      `上次交接请求结果未确认。当前任务为 v${currentTask.handoffVersion}，上次请求记录为 v${operation.expectedHandoffVersion}。将使用同一幂等键与原请求内容重试；服务端只会复用原交接或返回冲突，不会生成新的请求内容。`,
      { modal: true }, "使用原请求重试",
    );
    if (retry !== "使用原请求重试") return;
    payload = payloadFromOperation(operation);
  } else {
    if (
      !currentTask.updatedAt || !Number.isInteger(currentTask.handoffVersion) ||
      currentTask.handoffVersion !== manifest.handoffVersion ||
      new Date(currentTask.updatedAt).getTime() !== new Date(manifest.taskUpdatedAt).getTime()
    ) {
      void vscode.window.showWarningMessage(
        `当前任务契约/更新时间与已发布检查点不同（任务 v${currentTask.handoffVersion}，检查点 v${manifest.handoffVersion}）。未发起交接；请重新保存并发布当前基线。`,
      );
      return;
    }
    payload = {
      checkpointId: checkpointMapping.serverCheckpointId,
      toUserId: member.userId,
      expectedTaskUpdatedAt: new Date(currentTask.updatedAt).toISOString(),
      expectedHandoffVersion: currentTask.handoffVersion,
      idempotencyKey: reofferState
        ? stableIdempotencyKey(serverOrigin, binding.projectId, manifest.taskId, manifest.id, actor.id, member.userId, "reoffer", randomUUID())
        : stableIdempotencyKey(serverOrigin, binding.projectId, manifest.taskId, manifest.id, actor.id, member.userId),
    };
    operation = {
      serverOrigin,
      projectId: binding.projectId,
      taskId: manifest.taskId,
      localCheckpointId: manifest.id,
      serverCheckpointId: checkpointMapping.serverCheckpointId,
      recipientUserId: member.userId,
      expectedTaskUpdatedAt: payload.expectedTaskUpdatedAt,
      expectedHandoffVersion: payload.expectedHandoffVersion,
      idempotencyKey: payload.idempotencyKey,
      handoffId: null,
    };
  }

  const actionLabel = reofferState ? "重新发起交接" : isRetry ? "使用原请求重试" : "发起交接";
  const previousStateNotice = reofferState ? `此前交接已结束（${reofferState}）；确认后会创建新的交接记录，旧记录保留。\n\n` : "";
  const confirmation = await vscode.window.showInformationMessage(
    `${previousStateNotice}向 ${currentMember.displayName} ${reofferState ? "重新" : ""}发起交接？\n\n任务：${manifest.taskSnapshot.title}\n检查点：${manifest.handoff.goal}\n基线：${manifest.repository.headSha}\n任务契约：v${payload.expectedHandoffVersion}\n\n该操作只创建待处理交接单，不代表对方已收到材料、接受交接或启动 Agent。`,
    { modal: true }, actionLabel,
  );

  let record: ServerHandoff;
  let requestStarted = false;
  try {
    const result = await runConfirmedHandoff(
      confirmation === actionLabel,
      () => handoffMappings.set(operation!),
      async () => {
        requestStarted = true;
        return await api.createHandoff(binding.projectId, manifest.taskId, payload, actor.id);
      },
    );
    if (result.cancelled) return;
    record = result.value;
  } catch (error) {
    if (!requestStarted) {
      void vscode.window.showErrorMessage("无法持久化交接请求标识；为避免重试产生重复记录，未发送请求。");
      return;
    }
    if (error instanceof ApiError && error.status === 409) {
      void vscode.window.showWarningMessage("任务或幂等请求发生冲突。原交接请求已保留；刷新任务并核对平台交接记录后再继续。");
      return;
    }
    void vscode.window.showWarningMessage(`交接结果未确认；已保留同一幂等键，下次可安全重试。${error instanceof Error ? ` ${error.message}` : ""}`);
    return;
  }

  try {
    await handoffMappings.set({ ...operation, handoffId: record.id });
  } catch {
    void vscode.window.showWarningMessage(`交接已创建（${record.id}），但本地映射未能更新；请求的幂等键已保存在原待处理记录中。请在平台核对，勿新建另一条交接。`);
    return;
  }
  void vscode.window.showInformationMessage(`交接记录已确认，handoff ID：${record.id}；服务端状态：${record.state}。这不证明材料已到达对方本机或 Agent 已接续工作。`);
}

function payloadFromOperation(operation: HandoffOperationMapping): CreateHandoffPayload {
  return {
    checkpointId: operation.serverCheckpointId,
    toUserId: operation.recipientUserId,
    expectedTaskUpdatedAt: operation.expectedTaskUpdatedAt,
    expectedHandoffVersion: operation.expectedHandoffVersion,
    idempotencyKey: operation.idempotencyKey,
  };
}
