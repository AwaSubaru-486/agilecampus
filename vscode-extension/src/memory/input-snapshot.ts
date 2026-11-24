import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { parseNormalizedEventV1 } from "../../../shared/session-memory/schema";
import { readRepositorySnapshot, sameRepositorySnapshot, type RepositorySnapshot } from "../git/repository-service";
import { validateServerUrl } from "../agilecampus/api-client";
import type { LocalSessionStore } from "../session-memory/local-store";
import {
  MEMORY_SNAPSHOT_MAX_BYTES,
  MEMORY_SNAPSHOT_SCHEMA,
  type ExtractionSnapshotV1,
  type MemoryScope,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;

export class MemorySnapshotError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "MemorySnapshotError"; }
}

export type SnapshotDependencies = {
  store: LocalSessionStore;
  workspacePath: string;
  localRepositoryId: string;
  now?: () => Date;
  makeId?: () => string;
  readRepository?: (workspacePath: string, localId: string) => Promise<RepositorySnapshot>;
};

export async function createInputSnapshot(scope: MemoryScope, dependencies: SnapshotDependencies): Promise<ExtractionSnapshotV1> {
  const normalizedScope = parseScope(scope);
  const canonicalWorkspace = await realpath(dependencies.workspacePath).catch(() => {
    throw new MemorySnapshotError("WORKSPACE_UNAVAILABLE", "绑定的工作区不可访问");
  });
  const workspaceScope = sha256(canonicalWorkspace);
  if (workspaceScope !== normalizedScope.workspaceScope) throw new MemorySnapshotError("SCOPE_MISMATCH", "当前工作区与会话绑定不一致");

  const readRepository = dependencies.readRepository ?? readRepositorySnapshot;
  const before = await readRepository(canonicalWorkspace, dependencies.localRepositoryId);
  const capture = await dependencies.store.freezeCapture(normalizedScope.sessionKey).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "无法冻结会话记录";
    const code = message.includes("SNAPSHOT_TOO_LARGE") ? "SNAPSHOT_TOO_LARGE"
      : message.includes("EMPTY_CAPTURE") ? "EMPTY_CAPTURE" : "CAPTURE_INVALID";
    throw new MemorySnapshotError(code, message);
  });
  const after = await readRepository(canonicalWorkspace, dependencies.localRepositoryId);
  if (!sameRepositorySnapshot(before, after)) throw new MemorySnapshotError("REPOSITORY_CHANGED", "冻结期间 Git 仓库状态发生变化；会话记录已保留，请重新尝试");

  if (capture.binding.sessionKey !== normalizedScope.sessionKey || capture.binding.projectId !== normalizedScope.projectId ||
      capture.binding.taskId !== normalizedScope.taskId || capture.binding.workspacePath !== canonicalWorkspace) {
    throw new MemorySnapshotError("SCOPE_MISMATCH", "本地会话绑定与当前项目、任务或工作区不一致");
  }
  if (!capture.events.length) throw new MemorySnapshotError("EMPTY_CAPTURE", "会话没有可整理的记录");
  const events = capture.events.map(parseNormalizedEventV1);
  const orderedEventIds = events.map((event) => event.id);
  const perEventHashes = events.map((event) => sha256(stableStringify(event)));
  const gapEventIds = events.filter((event) => event.kind === "gap").map((event) => event.id);
  const captureFailures = capture.failures.map((failure) => ({ occurredAt: failure.occurredAt, category: "source-write-failed" as const }));
  const bodyBytes = events.reduce((total, event) => total + Buffer.byteLength(JSON.stringify(event)), 0);
  const snapshotWithoutDigest = {
    schemaVersion: MEMORY_SNAPSHOT_SCHEMA,
    snapshotId: (dependencies.makeId ?? randomUUID)(),
    scope: normalizedScope,
    createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    fromSequence: events[0].sequence,
    toSequence: events[events.length - 1].sequence,
    orderedEventIds,
    events,
    perEventHashes,
    captureFailures,
    gapEventIds,
    captureCompleteness: gapEventIds.length || captureFailures.length ? "partial" as const : "unknown" as const,
    repositoryKeyHash: sha256(before.key),
    headSha: before.headSha,
    branch: before.branch,
    dirtyExcluded: before.dirty,
    repositoryBlockers: [...before.recoveryBlockers],
    contentBytes: bodyBytes,
  };
  const encodedBytes = Buffer.byteLength(stableStringify(snapshotWithoutDigest));
  if (encodedBytes > MEMORY_SNAPSHOT_MAX_BYTES) throw new MemorySnapshotError("SNAPSHOT_TOO_LARGE", "冻结记录超过 10 MiB 上限；原始事件仍保留在本机");
  const captureDigest = computeCaptureDigest(snapshotWithoutDigest);
  return parseExtractionSnapshot({ ...snapshotWithoutDigest, captureDigest });
}

export function parseScope(value: unknown): MemoryScope {
  if (!isRecord(value) || !validServerOrigin(value.serverOrigin) || !HASH.test(text(value.actorScope)) ||
      !HASH.test(text(value.workspaceScope)) || !UUID.test(text(value.projectId)) || !UUID.test(text(value.taskId)) ||
      !UUID.test(text(value.sessionKey))) {
    throw new MemorySnapshotError("INVALID_SCOPE", "记忆整理范围无效");
  }
  return {
    serverOrigin: canonicalServerOrigin(text(value.serverOrigin)),
    actorScope: text(value.actorScope).toLowerCase(), workspaceScope: text(value.workspaceScope).toLowerCase(),
    projectId: text(value.projectId), taskId: text(value.taskId), sessionKey: text(value.sessionKey),
  };
}

export function parseExtractionSnapshot(value: unknown): ExtractionSnapshotV1 {
  if (!isRecord(value) || value.schemaVersion !== MEMORY_SNAPSHOT_SCHEMA || !UUID.test(text(value.snapshotId)) ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new MemorySnapshotError("INVALID_SNAPSHOT", "记忆快照结构无效");
  }
  const orderedEventIds = value.orderedEventIds as unknown[];
  const perEventHashes = value.perEventHashes as unknown[];
  const scope = parseScope(value.scope);
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > 20_000 ||
      !Array.isArray(orderedEventIds) || !Array.isArray(perEventHashes) ||
      value.events.length !== orderedEventIds.length || value.events.length !== perEventHashes.length ||
      !orderedEventIds.every((item) => typeof item === "string") || !perEventHashes.every((item) => typeof item === "string" && HASH.test(item)) ||
      !Array.isArray(value.captureFailures) || !Array.isArray(value.gapEventIds) || !Array.isArray(value.repositoryBlockers)) {
    throw new MemorySnapshotError("INVALID_SNAPSHOT", "会话快照记录数量或校验信息无效");
  }
  const events = value.events.map(parseNormalizedEventV1);
  if (!Number.isSafeInteger(value.fromSequence) || !Number.isSafeInteger(value.toSequence) ||
      value.fromSequence !== events[0].sequence || value.toSequence !== events[events.length - 1].sequence ||
      events.some((event, index) => event.sessionKey !== scope.sessionKey || event.sequence !== value.fromSequence as number + index ||
        event.id !== orderedEventIds[index] || sha256(stableStringify(event)) !== perEventHashes[index])) {
    throw new MemorySnapshotError("INVALID_SNAPSHOT", "事件顺序、会话范围或事件摘要校验失败");
  }
  const gaps = events.filter((event) => event.kind === "gap").map((event) => event.id);
  const actualContentBytes = events.reduce((total, event) => total + Buffer.byteLength(JSON.stringify(event)), 0);
  if (actualContentBytes !== value.contentBytes || JSON.stringify(gaps) !== JSON.stringify(value.gapEventIds) ||
      !value.captureFailures.every((item) => isRecord(item) && text(item.category) === "source-write-failed" && Number.isFinite(Date.parse(text(item.occurredAt))))) {
    throw new MemorySnapshotError("INVALID_SNAPSHOT", "来源缺口或失败摘要无效");
  }
  if (value.captureCompleteness !== (gaps.length || value.captureFailures.length ? "partial" : "unknown") ||
      !HASH.test(text(value.repositoryKeyHash)) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(text(value.headSha)) ||
      !(value.branch === null || typeof value.branch === "string") || typeof value.dirtyExcluded !== "boolean" ||
      !value.repositoryBlockers.every((item) => typeof item === "string") || !Number.isSafeInteger(value.contentBytes) || (value.contentBytes as number) < 0 ||
      !HASH.test(text(value.captureDigest))) {
    throw new MemorySnapshotError("INVALID_SNAPSHOT", "仓库基线或完整性状态无效");
  }
  const normalized = {
    schemaVersion: 1 as const,
    snapshotId: text(value.snapshotId), scope, createdAt: text(value.createdAt),
    fromSequence: value.fromSequence as number, toSequence: value.toSequence as number,
    orderedEventIds: orderedEventIds as string[], events,
    perEventHashes: perEventHashes as string[],
    captureFailures: value.captureFailures as ExtractionSnapshotV1["captureFailures"],
    gapEventIds: value.gapEventIds as string[], captureCompleteness: value.captureCompleteness as ExtractionSnapshotV1["captureCompleteness"],
    repositoryKeyHash: text(value.repositoryKeyHash), headSha: text(value.headSha), branch: value.branch as string | null,
    dirtyExcluded: value.dirtyExcluded, repositoryBlockers: value.repositoryBlockers as string[],
    captureDigest: text(value.captureDigest), contentBytes: value.contentBytes as number,
  };
  if (Buffer.byteLength(stableStringify(normalized)) > MEMORY_SNAPSHOT_MAX_BYTES ||
      computeCaptureDigest(normalized) !== normalized.captureDigest) {
    throw new MemorySnapshotError("SNAPSHOT_TAMPERED", "会话快照摘要校验失败");
  }
  return normalized;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function workspaceScopeHash(workspacePath: string): Promise<string> {
  return realpath(workspacePath).then((canonical) => sha256(canonical));
}

function snapshotProjection(snapshot: Record<string, unknown>): Record<string, unknown> {
  const { snapshotId: _id, createdAt: _created, captureDigest: _digest, ...stable } = snapshot;
  return stable;
}
export function computeCaptureDigest(snapshot: Record<string, unknown>): string {
  return sha256(stableStringify(snapshotProjection(snapshot)));
}
function validServerOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return validateServerUrl(value).toString() === value; } catch { return false; }
}
function canonicalServerOrigin(value: string): string { return validateServerUrl(value).toString(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
