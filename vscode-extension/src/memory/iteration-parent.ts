import type { MemoryDocumentV1, MemoryParentReferenceV1 } from "../../../shared/session-memory/types";
import { parseMemoryHandoffExport } from "../../../shared/task-memory/transfer";
import { MemoryArtifactStore } from "./artifact-store";
import { sha256, stableStringify } from "./input-snapshot";
import type { MemoryScope } from "./types";

export type IterationParentResult = { parent?: MemoryDocumentV1; source: "local" | "server" | "none" | "unavailable"; notice?: string };

/** Retrieve one already-shared exact parent, never a latest-version or another-task fallback. */
export async function resolveIterationParent(
  store: MemoryArtifactStore,
  scope: MemoryScope,
  reference: MemoryParentReferenceV1 | undefined,
  fetchParent: (reference: MemoryParentReferenceV1) => Promise<unknown>,
): Promise<IterationParentResult> {
  if (!reference) return { source: "none" };
  const matches = (memory: MemoryDocumentV1) => memory.id === reference.memoryId && memory.revision === reference.revision &&
    memory.projectId === scope.projectId && memory.taskId === scope.taskId && sha256(stableStringify(memory)) === reference.memoryDigest;
  const local = (await store.listReceivedExports(scope)).find((record) => matches(record.memory));
  if (local) return { parent: local.memory, source: "local" };
  try {
    const raw = await fetchParent(reference);
    if (!raw || typeof raw !== "object") throw new Error("invalid response");
    const payload = parseMemoryHandoffExport((raw as { payload?: unknown }).payload);
    if (!matches(payload.memory) || payload.material.scope.serverOrigin !== scope.serverOrigin) throw new Error("parent mismatch");
    await store.saveReceivedExport(payload, { ...scope, sessionKey: payload.memory.sessionKey });
    return { parent: payload.memory, source: "server", notice: "已从当前项目读取并校验精确父版本，保存到本机记忆库。" };
  } catch {
    return { source: "unavailable", notice: "精确父版本暂不可用或校验未通过；可继续审核当前草稿。检查连接、项目权限或父版本是否已共享后，再选择“查看本轮迭代结果”重试。" };
  }
}
