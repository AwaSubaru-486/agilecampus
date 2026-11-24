import { createHash } from "node:crypto";
import { parseMemoryDocumentV1 } from "../session-memory/schema";
import type { MemoryDocumentV1 } from "../session-memory/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
export class HandoffMaterialError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "HandoffMaterialError"; }
}

export type MemoryHandoffMaterialV1 = {
  schemaVersion: 1;
  materialId: string;
  memoryId: string;
  revision: number;
  scope: { serverOrigin: string; projectId: string; taskId: string; sessionKey: string };
  repositoryKeyHash: string;
  baseSha: string;
  dirtyExcluded: boolean;
  repositoryBlockers: string[];
  sourceRange: { from: number; to: number; gaps: string[]; omittedEventIds: string[]; truncatedEventIds: string[] };
  goal: string[];
  constraints: string[];
  completed: string[];
  remaining: string[];
  decisions: string[];
  rejectedApproaches: string[];
  blockers: string[];
  nextActions: string[];
  tests: MemoryDocumentV1["tests"];
  evidenceIndex: Array<{ itemId: string; eventIds: string[] }>;
  uncertainItems: Array<{ category: "goal" | "constraints" | "completed" | "remaining" | "decisions" | "rejectedApproaches" | "blockers" | "nextActions" | "tests"; itemId: string; text: string; eventIds: string[] }>;
  completeness: "unknown" | "partial";
  materialDigest: string;
};

export type MemoryHandoffExportV1 = {
  format: "agilecampus-memory-handoff";
  schemaVersion: 1;
  memory: MemoryDocumentV1;
  material: MemoryHandoffMaterialV1;
};

export function parseHandoffMaterial(value: unknown): MemoryHandoffMaterialV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !UUID.test(text(value.materialId)) || !UUID.test(text(value.memoryId)) ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !isRecord(value.scope) ||
      !UUID.test(text(value.scope.projectId)) || !UUID.test(text(value.scope.taskId)) || !UUID.test(text(value.scope.sessionKey)) ||
      typeof value.scope.serverOrigin !== "string" || !HASH.test(text(value.repositoryKeyHash)) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(text(value.baseSha)) || typeof value.dirtyExcluded !== "boolean" ||
      !Array.isArray(value.repositoryBlockers) || value.repositoryBlockers.length > 100 || !value.repositoryBlockers.every((item) => typeof item === "string" && item.length <= 500) ||
      !isRecord(value.sourceRange) || !Number.isSafeInteger(value.sourceRange.from) || !Number.isSafeInteger(value.sourceRange.to) ||
      (value.sourceRange.from as number) < 1 || (value.sourceRange.to as number) < (value.sourceRange.from as number) ||
      !Array.isArray(value.sourceRange.gaps) || !value.sourceRange.gaps.every(isUuid) ||
      new Set(value.sourceRange.gaps as unknown[]).size !== (value.sourceRange.gaps as unknown[]).length ||
      !Array.isArray(value.sourceRange.omittedEventIds) || !value.sourceRange.omittedEventIds.every(isUuid) ||
      new Set(value.sourceRange.omittedEventIds as unknown[]).size !== (value.sourceRange.omittedEventIds as unknown[]).length ||
      !Array.isArray(value.sourceRange.truncatedEventIds) || !value.sourceRange.truncatedEventIds.every(isUuid) ||
      new Set(value.sourceRange.truncatedEventIds as unknown[]).size !== (value.sourceRange.truncatedEventIds as unknown[]).length ||
      !["unknown", "partial"].includes(text(value.completeness)) || !HASH.test(text(value.materialDigest)) ||
      !Array.isArray(value.evidenceIndex) || value.evidenceIndex.length > 1000 ||
      !Array.isArray(value.tests) || value.tests.length > 500 ||
      !Array.isArray(value.uncertainItems) || value.uncertainItems.length > 1000) {
    throw new HandoffMaterialError("INVALID_MATERIAL", "接班材料格式无效");
  }
  const allowed = new Set(["schemaVersion", "materialId", "memoryId", "revision", "scope", "repositoryKeyHash", "baseSha", "dirtyExcluded", "repositoryBlockers", "sourceRange", "goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions", "tests", "evidenceIndex", "uncertainItems", "completeness", "materialDigest"]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
      Object.keys(value.scope).some((key) => !["serverOrigin", "projectId", "taskId", "sessionKey"].includes(key)) ||
      Object.keys(value.sourceRange).some((key) => !["from", "to", "gaps", "omittedEventIds", "truncatedEventIds"].includes(key))) {
    throw new HandoffMaterialError("INVALID_MATERIAL", "接班材料包含不支持的字段");
  }
  for (const field of ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const) {
    if (!Array.isArray(value[field]) || value[field].length > 500 || !value[field].every((item) => typeof item === "string" && item.length <= 2000)) throw new HandoffMaterialError("INVALID_MATERIAL", "接班材料记忆字段无效");
  }
  for (const test of value.tests as unknown[]) if (!isRecord(test) || typeof test.command !== "string" || !test.command.trim() || test.command.length > 1000 ||
      !(test.exitCode === null || Number.isSafeInteger(test.exitCode)) || !["captured", "reported"].includes(text(test.support)) ||
      !Array.isArray(test.evidenceRefs) || test.evidenceRefs.length < 1 || test.evidenceRefs.length > 10 || !test.evidenceRefs.every(isUuid)) {
    throw new HandoffMaterialError("INVALID_MATERIAL", "接班材料测试记录无效");
  }
  const evidenceIds = new Set<string>();
  for (const item of value.evidenceIndex as unknown[]) {
    if (!isRecord(item) || typeof item.itemId !== "string" || !item.itemId || item.itemId.length > 128 || evidenceIds.has(item.itemId) ||
        !Array.isArray(item.eventIds) || item.eventIds.length > 10 || !item.eventIds.every(isUuid)) {
      throw new HandoffMaterialError("INVALID_MATERIAL", "接班材料出处索引无效");
    }
    evidenceIds.add(item.itemId);
  }
  for (const item of value.uncertainItems as unknown[]) if (!isRecord(item) ||
      !["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions", "tests"].includes(text(item.category)) ||
      typeof item.itemId !== "string" || !item.itemId || item.itemId.length > 128 || typeof item.text !== "string" || item.text.length > 2000 ||
      !Array.isArray(item.eventIds) || item.eventIds.length > 10 || !item.eventIds.every(isUuid)) {
    throw new HandoffMaterialError("INVALID_MATERIAL", "接班材料待核对记录无效");
  }
  const origin = text(value.scope.serverOrigin);
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.toString() !== origin) throw new Error();
  } catch { throw new HandoffMaterialError("INVALID_MATERIAL", "接班材料服务地址无效"); }
  const { materialDigest, ...body } = value;
  if (sha256(stableStringify(body)) !== materialDigest) throw new HandoffMaterialError("MATERIAL_TAMPERED", "接班材料完整性校验失败");
  return value as unknown as MemoryHandoffMaterialV1;
}

export function parseMemoryHandoffExport(value: unknown): MemoryHandoffExportV1 {
  if (!isRecord(value) || value.format !== "agilecampus-memory-handoff" || value.schemaVersion !== 1 ||
      Object.keys(value).some((key) => key !== "format" && key !== "schemaVersion" && key !== "memory" && key !== "material")) {
    throw new Error("接班 JSON 格式或版本无效");
  }
  const material = parseHandoffMaterial(value.material);
  const memory = parseMemoryDocumentV1(value.memory);
  const evidence = new Map(material.evidenceIndex.map((item) => [item.itemId, [...item.eventIds].sort()]));
  const checkRefs = (itemId: string, refs: string[]) => {
    const indexed = evidence.get(itemId);
    if (!indexed || stableStringify([...refs].sort()) !== stableStringify(indexed)) throw new Error("记忆正文的出处与接班材料索引不一致");
  };
  for (const category of ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const) {
    for (const item of memory[category]) checkRefs(item.id, item.evidenceRefs);
  }
  for (const category of ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const) {
    const acceptedText = memory[category].filter((item) => item.disposition === "active").map((item) => item.text);
    if (stableStringify(material[category]) !== stableStringify(acceptedText)) {
      throw new Error("接班材料记忆内容与人工接受的记忆版本不一致");
    }
  }
  for (const [index, test] of memory.tests.entries()) checkRefs(`test:${index}`, test.evidenceRefs);
  for (const category of ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const) {
    for (const item of memory[category].filter((entry) => entry.disposition === "uncertain")) {
      const indexed = material.uncertainItems.find((entry) => entry.category === category && entry.itemId === item.id);
      if (!indexed || indexed.text !== item.text || stableStringify([...indexed.eventIds].sort()) !== stableStringify([...item.evidenceRefs].sort())) {
        throw new Error("记忆正文的待核对条目与接班材料不一致");
      }
    }
  }
  const uncertainTestItems = material.uncertainItems.filter((item) => item.category === "tests");
  for (const uncertain of uncertainTestItems) {
    const index = Number(uncertain.itemId.slice("test:".length));
    const test = memory.tests[index];
    if (!uncertain.itemId.startsWith("test:") || !Number.isSafeInteger(index) || !test || uncertain.text !== test.command ||
        stableStringify([...uncertain.eventIds].sort()) !== stableStringify([...test.evidenceRefs].sort())) {
      throw new Error("记忆正文的待核对测试与接班材料不一致");
    }
  }
  const uncertainTestIndexes = new Set(uncertainTestItems.map((item) => item.itemId));
  const activeMemoryTests = memory.tests.filter((_test, index) => !uncertainTestIndexes.has(`test:${index}`));
  if (stableStringify(activeMemoryTests) !== stableStringify(material.tests)) throw new Error("记忆正文的测试记录与接班材料不一致");
  if (memory.id !== material.memoryId || memory.revision !== material.revision ||
      memory.projectId !== material.scope.projectId || memory.taskId !== material.scope.taskId ||
      memory.sessionKey !== material.scope.sessionKey || memory.code.repositoryKeyHash !== material.repositoryKeyHash ||
      memory.code.headSha !== material.baseSha || memory.code.dirtyExcluded !== material.dirtyExcluded ||
      memory.sourceCoverage.fromSequence !== material.sourceRange.from ||
      memory.sourceCoverage.toSequence !== material.sourceRange.to ||
      stableStringify(memory.sourceCoverage.gaps) !== stableStringify(material.sourceRange.gaps)) {
    throw new Error("导出包中的记忆与接班材料不匹配");
  }
  return { format: "agilecampus-memory-handoff", schemaVersion: 1, memory, material };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function memoryTransferDigest(value: unknown): string { return sha256(stableStringify(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
