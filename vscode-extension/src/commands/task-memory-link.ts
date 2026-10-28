import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import { AttemptStore } from "../attempts/store";
import { LocalSessionStore } from "../session-memory/local-store";
import { parseTaskMemoryLink } from "../../../shared/task-memory/links";
import { parseMemoryHandoffExport, MemoryArtifactStore } from "../memory/artifact-store";
import { createReceivedMemoryCheckpoint } from "../memory/received-checkpoint";
import { sha256, workspaceScopeHash } from "../memory/input-snapshot";
import { readRepositorySnapshot } from "../git/repository-service";
import { CheckpointStore } from "../checkpoints/store";
import { createWorkspaceApi, getLocalOnlyRepositoryId, selectBoundWorkspace } from "./checkpoint-support";
import { createContinuationReporter, type ContinuationObserver } from "../memory/continuation-reporter";

export function registerTaskMemoryLinks(context: vscode.ExtensionContext): void {
  let active = false;
  context.subscriptions.push(vscode.window.registerUriHandler({
    async handleUri(uri) {
      if (active) { void vscode.window.showInformationMessage("正在处理任务记忆，请完成当前操作后再试。"); return; }
      active = true;
      let report: ContinuationObserver | undefined;
      let delegated = false;
      try {
        const request = parseTaskMemoryLink(uri.toString());
        if (!vscode.workspace.isTrusted) throw new Error("请先信任当前工作区，再处理任务记忆");
        const selected = await selectBoundWorkspace(context);
        if (!selected) return;
        const serverOrigin = new URL(selected.binding.serverOrigin).toString();
        if (request.serverOrigin !== serverOrigin || request.projectId !== selected.binding.projectId) throw new Error("请在 VS Code 中连接与网页相同的服务和项目后重试");
        const api = createWorkspaceApi(context, selected.binding);
        const [actor, task] = await Promise.all([api.getCurrentActor(), api.getTask(request.taskId)]);
        if (task.projectId !== request.projectId || task.id !== request.taskId) throw new Error("任务不属于当前项目");
        if (request.action === "review") {
          const attempt = (await new AttemptStore(context.globalStorageUri.fsPath).list()).find((entry) => entry.id === request.attemptId);
          if (!attempt || attempt.projectId !== request.projectId || attempt.taskId !== request.taskId ||
              !attempt.memoryInheritance || !attempt.providerSessionId || !["finished", "failed"].includes(attempt.state) ||
              await realpath(attempt.workdir).catch(() => null) !== await realpath(selected.folder.uri.fsPath)) {
            throw new Error("当前工作区没有对应的已结束接续会话，请在执行该会话的工作区整理断点");
          }
          const sessions = (await new LocalSessionStore(context.globalStorageUri.fsPath).list(selected.folder.uri.fsPath, request.projectId, request.taskId))
            .filter((entry) => entry.providerSessionId === attempt.providerSessionId);
          if (sessions.length !== 1) throw new Error("无法唯一定位本次执行的会话，未选择其他会话代替");
          await vscode.commands.executeCommand("agilecampus.extractSessionMemory", { taskId: request.taskId, sessionKey: sessions[0].sessionKey });
          return;
        }
        const scope = { serverOrigin, projectId: request.projectId, taskId: request.taskId,
          actorScope: sha256(`agilecampus-actor-v1\0${serverOrigin}\0${actor.id}`), workspaceScope: await workspaceScopeHash(selected.folder.uri.fsPath) };
        const store = new MemoryArtifactStore(context.globalStorageUri.fsPath);
        if (request.action === "publish") {
          let records = await store.listReceivedExports(scope);
          if (!records.length) {
            const action = await vscode.window.showInformationMessage("此任务还没有已确认的记忆，请先提炼并审核会话。", "提炼此任务会话");
            if (action !== "提炼此任务会话") return;
            await vscode.commands.executeCommand("agilecampus.extractSessionMemory", { taskId: request.taskId });
            records = await store.listReceivedExports(scope);
            if (!records.length) return;
          }
          const choice = await vscode.window.showQuickPick(records.map((record) => ({
            label: `r${record.memory.revision} · ${record.material.goal[0] || task.title}`,
            description: `${record.material.baseSha.slice(0, 10)} · ${record.memory.provenance.createdAt}`, record,
          })), { title: `保存工作断点 · ${task.title}` });
          if (!choice) return;
          const confirm = await vscode.window.showWarningMessage("将此已确认版本的工作记忆保存给当前项目成员查看和接续，不上传原始对话或代码。", { modal: true }, "同步到任务网页");
          if (confirm !== "同步到任务网页") return;
          await api.publishTaskMemory(request.projectId, request.taskId, choice.record);
          void vscode.window.showInformationMessage("工作断点已同步，任务网页可以查看并接续此版本。");
          return;
        }
        if (request.requestId) {
          const { claimId } = await api.claimTaskMemoryContinuation(request.projectId, request.taskId, request.requestId, request.versionId!);
          report = createContinuationReporter((sequence, progress) => api.reportTaskMemoryContinuation(request.projectId, request.taskId, {
            id: request.requestId!, claimId, sequence, ...progress,
          }));
          await report({ state: "checking" });
        }
        const raw = await api.getSharedTaskMemory(request.projectId, request.taskId, request.versionId!);
        if (!raw || typeof raw !== "object" || (raw as { id?: unknown }).id !== request.versionId) throw new Error("服务返回了不同的记忆版本");
        const handoff = parseMemoryHandoffExport((raw as { payload?: unknown }).payload);
        const repository = await readRepositorySnapshot(selected.folder.uri.fsPath, await getLocalOnlyRepositoryId(context, selected.folder.uri.toString()));
        const checkpoint = createReceivedMemoryCheckpoint(handoff, task, repository, serverOrigin);
        await store.saveReceivedExport(handoff, { ...scope, sessionKey: handoff.memory.sessionKey });
        await new CheckpointStore(context.globalStorageUri.fsPath).save(checkpoint, []);
        const launchRequest = {
          taskId: request.taskId, checkpointId: checkpoint.id, materialId: handoff.material.materialId,
        };
        if (report) {
          await vscode.commands.executeCommand("agilecampus.continueTaskMemory", launchRequest, report);
          delegated = true;
        } else await vscode.commands.executeCommand("agilecampus.continueTaskMemory", launchRequest);
      } catch (error) {
        if (report && !delegated) await report({ state: "failed" }).catch(() => undefined);
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : "任务记忆操作失败，请重试");
      }
      finally { active = false; }
    },
  }));
}
