import * as vscode from "vscode";
import { MemoryArtifactStore } from "../memory/artifact-store";
import { prepareMemoryContinuation, type MemoryContinuation } from "../memory/continuation";
import { sha256, workspaceScopeHash } from "../memory/input-snapshot";
import type { WorkCheckpoint } from "../checkpoints/types";
import type { RepositorySnapshot } from "../git/repository-service";
import type { WorkspaceBinding } from "../workspace/binding-store";
import { createWorkspaceApi } from "./checkpoint-support";

/** Adds the memory library to the existing launcher without creating another Agent runner. */
export async function selectContinuationMemory(
  context: vscode.ExtensionContext,
  binding: WorkspaceBinding,
  sourceWorkspace: string,
  checkpoint: WorkCheckpoint,
  repository: RepositorySnapshot | null,
  required: boolean,
  materialId?: string,
): Promise<MemoryContinuation | null | undefined> {
  const actor = await createWorkspaceApi(context, binding).getCurrentActor();
  const serverOrigin = new URL(binding.serverOrigin).toString();
  const scope = {
    serverOrigin, projectId: binding.projectId, taskId: checkpoint.taskId,
    actorScope: sha256(`agilecampus-actor-v1\0${serverOrigin}\0${actor.id}`),
    workspaceScope: await workspaceScopeHash(sourceWorkspace),
  };
  const available = await new MemoryArtifactStore(context.globalStorageUri.fsPath).listReceivedExports(scope);
  const records = materialId ? available.filter((record) => record.material.materialId === materialId) : available;
  if (!records.length) {
    if (materialId) throw new Error("指定的任务记忆版本在当前账号及工作区不可用；未改用其他版本");
    if (required) throw new Error("此任务尚无可继承的已确认记忆。请先提炼并接受会话记忆，或导入队友的接班 JSON；旧检查点摘要不能代替记忆继承。");
    return null;
  }
  const choices = records.map((record) => ({
    label: `r${record.memory.revision} · ${record.material.goal[0] ?? record.memory.id}`,
    description: `${record.material.baseSha.slice(0, 10)} · ${record.material.baseSha === repository?.headSha ? "代码基线匹配" : "代码已变化，需核对"}`,
    detail: `记忆 ${record.memory.id} · 来源 ${record.memory.sessionKey} · ${record.memory.provenance.createdAt}`,
    record,
  }));
  const choice = materialId ? choices[0] : await vscode.window.showQuickPick([
    ...choices,
    ...(!required ? [{ label: "仅使用旧检查点材料", description: "本次不记录记忆继承", detail: "", record: null }] : []),
  ], { title: "选择要继承的任务记忆", placeHolder: "新会话使用选定的固定版本；其他方案的后续记录不会混入" });
  if (!choice) return undefined;
  if (!choice.record) return null;
  const continuation = prepareMemoryContinuation(choice.record, {
    serverOrigin, projectId: binding.projectId, taskId: checkpoint.taskId,
    accessConfirmed: true, receivedRevision: choice.record.memory.revision,
    repositoryKeyHash: repository ? sha256(repository.key) : null,
    currentHeadSha: repository?.headSha ?? null,
    workspaceReady: repository !== null, workspaceClean: repository !== null && !repository.dirty,
    workspaceBlockers: repository?.recoveryBlockers ?? [],
  });
  const preview = await vscode.workspace.openTextDocument({ language: "plaintext", content: continuation.report });
  await vscode.window.showTextDocument(preview, { preview: true });
  if (!continuation.resume.ready) throw new Error(`记忆接续未通过：${continuation.resume.blockers.join("；")}`);
  return continuation;
}
