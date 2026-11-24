import * as vscode from "vscode";
import { ApiError, type CheckpointIndexPayload, type ServerCheckpoint } from "../agilecampus/api-client";
import { checkpointSummaryMatches, fullCheckpointMatches, toCheckpointIndexPayload } from "../checkpoints/index-payload";
import { ServerCheckpointMappingStore } from "../checkpoints/server-mapping";
import { stableIdempotencyKey } from "../checkpoints/idempotency";
import { CheckpointPublishOperationStore } from "../checkpoints/publish-operation";
import { CheckpointStore } from "../checkpoints/store";
import { createWorkspaceApi, selectBoundWorkspace } from "./checkpoint-support";

export function registerPublishCheckpointCommand(context: vscode.ExtensionContext): void {
  let inFlight = false;
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.publishCheckpoint", async () => {
    if (inFlight) {
      void vscode.window.showInformationMessage("检查点发布正在处理，请等待当前请求完成。");
      return;
    }
    inFlight = true;
    try { await publishCheckpoint(context); }
    finally { inFlight = false; }
  }));
}

async function publishCheckpoint(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage("此操作需要先信任当前 VS Code 工作区。");
    return;
  }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const { binding } = selected;
  const api = createWorkspaceApi(context, binding);
  const localStore = new CheckpointStore(context.globalStorageUri.fsPath);
  const local = await localStore.list(binding.serverOrigin, binding.projectId).catch((error: unknown) => {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取本地检查点");
    return [];
  });
  if (!local.length) {
    void vscode.window.showInformationMessage("当前项目没有本地检查点。先执行“保存本地检查点”。");
    return;
  }
  const selectedCheckpoint = await vscode.window.showQuickPick(local.map(({ manifest }) => ({
    label: manifest.handoff.goal,
    description: `${manifest.taskSnapshot.title} · ${manifest.repository.headSha.slice(0, 10)} · ${new Date(manifest.capturedAt).toLocaleString()}`,
    detail: `${manifest.handoff.completed.length} 项已完成，${manifest.handoff.remaining.length} 项待处理`,
    manifest,
  })), { title: "选择要发布的本地检查点摘要" });
  if (!selectedCheckpoint) return;
  const manifest = selectedCheckpoint.manifest;
  const serverOrigin = api.baseUrl.toString();
  const mappings = new ServerCheckpointMappingStore(context.workspaceState);
  const parentMapping = manifest.parentCheckpointId
    ? mappings.get(serverOrigin, binding.projectId, manifest.taskId, manifest.parentCheckpointId)
    : null;
  if (manifest.parentCheckpointId && !parentMapping) {
    void vscode.window.showErrorMessage("此检查点来自导入包，但父检查点尚未映射到服务端。请从含有效服务端来源的交接包重新导入后发布。");
    return;
  }
  const parentServerCheckpointId = parentMapping?.serverCheckpointId ?? null;
  const pendingStore = new CheckpointPublishOperationStore(context.workspaceState);
  const pending = pendingStore.get(serverOrigin, binding.projectId, manifest.taskId, manifest.id);
  const existingMapping = mappings.get(serverOrigin, binding.projectId, manifest.taskId, manifest.id);
  if (existingMapping) {
    try {
      const remote = await api.getCheckpointIndex(existingMapping.serverCheckpointId);
      const expectedPayload = toCheckpointIndexPayload(manifest, remote.visibility, parentServerCheckpointId);
      if (
        remote.id !== existingMapping.serverCheckpointId ||
        !fullCheckpointMatches(remote, binding.projectId, manifest.taskId, expectedPayload)
      ) {
        void vscode.window.showErrorMessage("本地发布映射与服务端检查点不一致，未重复创建。请先核对服务端记录。");
        return;
      }
      void vscode.window.showInformationMessage(`检查点摘要已发布（${remote.id}）；未重复登记。`);
    } catch (error) {
      void vscode.window.showErrorMessage(`已有发布映射，但无法核对服务端记录；未重复登记。${error instanceof Error ? ` ${error.message}` : ""}`);
    }
    return;
  }

  const scope = pending
    ? { label: pending.payload.visibility === "project" ? "项目成员可见" : "创建者、任务负责人和管理员可见", value: pending.payload.visibility }
    : await vscode.window.showQuickPick([
      { label: "项目成员可见", description: "索引摘要对当前项目成员可见。", value: "project" as const },
      { label: "创建者、任务负责人和管理员可见", description: "索引摘要使用 assignee 范围。", value: "assignee" as const },
    ], { title: "选择检查点摘要的共享范围" });
  if (!scope) return;
  const payload = pending?.payload ?? {
    ...toCheckpointIndexPayload(manifest, scope.value, parentServerCheckpointId),
    idempotencyKey: stableIdempotencyKey(serverOrigin, binding.projectId, manifest.taskId, manifest.id),
  };
  if (pending && pending.payload.parentCheckpointId !== parentServerCheckpointId) {
    void vscode.window.showErrorMessage("待确认发布的父检查点映射已变化；保留原请求，请先核对本机交接历史。");
    return;
  }
  const materials = payload.materials.length
    ? payload.materials.map((item) => `- ${item.kind} · ${item.byteLength} bytes · SHA-256 ${item.sha256}`).join("\n")
    : "- 无材料索引";
  const preview = [
    `目标：${payload.handoffSummary.goal}`,
    `已完成：${payload.handoffSummary.completed.join("；") || "无"}`,
    `待处理：${payload.handoffSummary.remaining.join("；") || "无"}`,
    `阻塞：${payload.handoffSummary.blocker ?? "无"}`,
    `下一步：${payload.handoffSummary.nextAction}`,
    `Git SHA：${payload.headSha}`,
    `材料清单：\n${materials}`,
    `共享范围：${scope.label}`,
    pending ? "这是上次未确认的同一请求；共享范围与幂等键保持不变。" : "",
    "不会上传 transcript 正文、文件路径、密钥、分支名或未提交代码。已尝试但放弃的方案保留在本地交接包中，不进入服务端索引。",
  ].join("\n\n");
  const confirm = await vscode.window.showInformationMessage(preview, { modal: true }, "确认发布摘要");
  if (confirm !== "确认发布摘要") return;

  try {
    await pendingStore.set({ serverOrigin, projectId: binding.projectId, taskId: manifest.taskId, localCheckpointId: manifest.id, payload });
  } catch (error) {
    void vscode.window.showErrorMessage(`无法保存发布请求标识；未向服务端发送。${error instanceof Error ? ` ${error.message}` : ""}`);
    return;
  }

  let serverRecord: ServerCheckpoint;
  try {
    serverRecord = await api.createCheckpointIndex(binding.projectId, manifest.taskId, payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      try {
        const current = await api.getTask(manifest.taskId);
        if (current.handoffVersion !== payload.taskHandoffVersion || new Date(current.updatedAt).getTime() !== new Date(payload.taskUpdatedAt).getTime()) {
          await pendingStore.clear(serverOrigin, binding.projectId, manifest.taskId, manifest.id);
          void vscode.window.showWarningMessage(`任务契约或时间戳已变化（检查点 v${manifest.handoffVersion}，当前 v${current.handoffVersion}）。本地检查点保留，未发布；请刷新任务并重新保存/核对。`);
        } else {
          void vscode.window.showWarningMessage("该幂等键已绑定不同的服务端请求。原请求仍保留；请核对服务端记录，不要更换共享范围后重试。");
        }
      } catch {
        void vscode.window.showWarningMessage("发布请求冲突，原请求标识已保留；连接恢复后继续用同一内容核对。");
      }
      return;
    }
    const uncertain = !(error instanceof ApiError) || error.status === null || error.status >= 500;
    if (uncertain) {
      const reconciled = await reconcile(api, binding.projectId, manifest.taskId, payload);
      if (reconciled.status === "one") {
        await persistMapping(mappings, serverOrigin, binding.projectId, manifest.taskId, manifest.id, reconciled.record.id);
        await pendingStore.clear(serverOrigin, binding.projectId, manifest.taskId, manifest.id).catch(() => undefined);
        void vscode.window.showInformationMessage(`服务端已登记检查点摘要（${reconciled.record.id}）；已恢复本地映射，未重复提交。`);
        return;
      }
      void vscode.window.showWarningMessage(
        reconciled.status === "many"
          ? "发布结果不确定，服务端存在多条匹配记录；为避免重复登记，未重试。请核对服务端记录。"
          : "本地已保存，发布结果未确认；为避免重复登记，未自动重试。恢复连接后先核对服务端检查点列表。",
      );
      return;
    }
    void vscode.window.showErrorMessage(error instanceof Error ? `本地已保存，未发布：${error.message}` : "本地已保存，未发布：请求失败");
    return;
  }

  try {
    await persistMapping(mappings, serverOrigin, binding.projectId, manifest.taskId, manifest.id, serverRecord.id);
  } catch {
    void vscode.window.showErrorMessage(`服务端已登记检查点（${serverRecord.id}），但本地映射未能保存。请勿再次发布；先核对服务端记录。`);
    return;
  }
  await pendingStore.clear(serverOrigin, binding.projectId, manifest.taskId, manifest.id).catch(() => undefined);
  void vscode.window.showInformationMessage(`检查点摘要已发布（${serverRecord.id}）。会话正文与代码未上传。`);
}

async function reconcile(
  api: ReturnType<typeof createWorkspaceApi>,
  projectId: string,
  taskId: string,
  payload: CheckpointIndexPayload,
): Promise<{ status: "one"; record: ServerCheckpoint } | { status: "none" | "many" }> {
  try {
    const candidates = await api.listCheckpointIndexes(projectId, taskId);
    const matches = candidates.filter((candidate) => checkpointSummaryMatches(candidate, payload));
    if (!matches.length) return { status: "none" };
    if (matches.length > 1) return { status: "many" };
    const full = await api.getCheckpointIndex(matches[0].id);
    if (!fullCheckpointMatches(full, projectId, taskId, payload)) return { status: "none" };
    return { status: "one", record: full };
  } catch {
    return { status: "none" };
  }
}

async function persistMapping(
  store: ServerCheckpointMappingStore,
  serverOrigin: string,
  projectId: string,
  taskId: string,
  localCheckpointId: string,
  serverCheckpointId: string,
): Promise<void> {
  await store.set({ serverOrigin, projectId, taskId, localCheckpointId, serverCheckpointId });
}
