import type {
  MemoryDocumentV1,
  MemoryItemV1,
  MemorySupport,
  NormalizedEventV1,
  SessionMemoryManifestV1,
  SessionMemoryPackageV1,
  SessionMemorySegmentV1,
  SourceArchiveEventRangeV1,
  SourceArchiveSegmentV1,
  SourceArchiveV1,
  SessionMemoryValidationContext,
} from "./types";

export const SESSION_MEMORY_MAX_SEGMENT_BYTES = 256 * 1024;
export const SESSION_MEMORY_MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export const SESSION_MEMORY_MAX_EVENTS = 20_000;
export const SESSION_MEMORY_MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
export const SESSION_MEMORY_MAX_ARCHIVE_SEGMENT_BYTES = 256 * 1024;
export const SESSION_MEMORY_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const SESSION_MEMORY_ARCHIVE_PARSER_V1 = "opaque-text-v1" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const EVENT_KINDS = ["user", "assistant", "tool_call", "tool_result", "git_snapshot", "gap"] as const;

export class SessionMemorySchemaError extends Error {
  constructor(message: string) { super(message); this.name = "SessionMemorySchemaError"; }
}

export type Sha256 = (bytes: Uint8Array) => string;

export type SourceArchiveBuildInput = Omit<SourceArchiveV1, "publishedDigest" | "publishedByteLength" | "segments"> & {
  segments: Array<{ relativePath: string; sourceStartByte: number; sourceEndByte: number; content: Uint8Array }>;
};

export function parseNormalizedEventV1(value: unknown): NormalizedEventV1 {
  if (!record(value) || value.schemaVersion !== 1) fail("事件格式或版本无效");
  const base = ["schemaVersion", "id", "sessionKey", "sequence", "timestamp", "kind", "text", "sourceRef"];
  const allowed = new Set([...base, "toolCallId", "command", "exitCode", "paths"]);
  keys(value, allowed, "事件包含不支持的字段");
  if (!UUID.test(str(value.id)) || !UUID.test(str(value.sessionKey))) fail("事件 ID 或会话 ID 无效");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) fail("事件序号无效");
  if (value.timestamp !== null && !iso(value.timestamp)) fail("事件时间无效");
  if (!(EVENT_KINDS as readonly string[]).includes(str(value.kind))) fail("事件类型不受支持");
  if (typeof value.text !== "string" || value.text.length > 256 * 1024) fail("事件正文无效或超过 256 KiB");
  if ((value.kind === "user" || value.kind === "assistant" || value.kind === "git_snapshot") && !value.text.trim()) fail("用户、助手和 Git 事件必须有正文");
  const sourceRef = str(value.sourceRef);
  if (!sourceRef || sourceRef.length > 2048) fail("事件来源引用无效");
  const kind = value.kind as NormalizedEventV1["kind"];
  const toolCallId = value.toolCallId;
  const command = value.command;
  const exitCode = value.exitCode;
  const paths = value.paths;
  if (kind === "tool_call" || kind === "tool_result") {
    if (!str(toolCallId)) fail("工具事件缺少 toolCallId");
  } else if (toolCallId !== undefined || command !== undefined || exitCode !== undefined) fail("非工具事件包含工具字段");
  if (command !== undefined && (typeof command !== "string" || command.length > 16_384)) fail("工具命令无效");
  if (kind !== "tool_result" && exitCode !== undefined) fail("只有工具结果可以包含 exitCode");
  if (exitCode !== undefined && exitCode !== null && (!Number.isSafeInteger(exitCode) || (exitCode as number) < -255 || (exitCode as number) > 255)) fail("工具退出码无效");
  if (paths !== undefined && (!stringArray(paths) || paths.some((item) => !safeRelativePath(item)))) fail("仓库相对路径无效");
  if (kind === "gap" && !value.text.trim()) fail("采集缺口必须说明原因");
  return {
    schemaVersion: 1, id: str(value.id), sessionKey: str(value.sessionKey), sequence: value.sequence as number,
    timestamp: value.timestamp as string | null, kind, text: value.text,
    ...(toolCallId !== undefined ? { toolCallId: str(toolCallId) } : {}),
    ...(command !== undefined ? { command: command as string } : {}),
    ...(exitCode !== undefined ? { exitCode: exitCode as number | null } : {}),
    ...(paths !== undefined ? { paths: paths as string[] } : {}), sourceRef,
  };
}

export function parseMemoryDocumentV1(value: unknown, eventIds?: ReadonlySet<string>): MemoryDocumentV1 {
  if (!record(value) || value.schemaVersion !== 1) fail("记忆文档格式或版本无效");
  const fields = ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const;
  keys(value, new Set(["schemaVersion", "id", "sessionKey", "projectId", "taskId", "parentMemoryId", "revision", "inputDigest", "sourceCoverage", "code", ...fields, "tests", "provenance"]), "记忆文档包含不支持的字段");
  if (!UUID.test(str(value.id)) || !UUID.test(str(value.sessionKey)) ||
      !(value.parentMemoryId === null || UUID.test(str(value.parentMemoryId))) || value.parentMemoryId === value.id) fail("记忆文档 ID 或父记忆引用无效");
  if (!str(value.projectId) || !str(value.taskId) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !HASH.test(str(value.inputDigest))) fail("记忆版本或项目关联无效");
  const coverage = parseCoverage(value.sourceCoverage);
  if (!record(value.code) || !HASH.test(str(value.code.repositoryKeyHash)) || !GIT_SHA.test(str(value.code.headSha)) || typeof value.code.dirtyExcluded !== "boolean") fail("记忆代码基线无效");
  const code = { repositoryKeyHash: str(value.code.repositoryKeyHash), headSha: str(value.code.headSha), dirtyExcluded: value.code.dirtyExcluded };
  const ids = new Set<string>();
  const items = {} as Pick<MemoryDocumentV1, (typeof fields)[number]>;
  for (const field of fields) {
    if (!Array.isArray(value[field]) || value[field].length > 500) fail(`记忆字段 ${field} 必须是最多 500 项的数组`);
    items[field] = (value[field] as unknown[]).map((item) => parseMemoryItem(item, ids, eventIds));
  }
  if (!Array.isArray(value.tests) || value.tests.length > 500) fail("测试记录必须是最多 500 项的数组");
  const tests = value.tests.map((test) => {
    if (!record(test)) fail("测试记录格式无效");
    keys(test, new Set(["command", "exitCode", "evidenceRefs", "support"]), "测试记录包含不支持的字段");
    const command = str(test.command);
    if (!command || command.length > 16_384 || !(test.exitCode === null || Number.isSafeInteger(test.exitCode))) fail("测试命令或退出码无效");
    if (test.support !== "captured" && test.support !== "reported") fail("测试记录 support 不受支持");
    const evidenceRefs = parseRefs(test.evidenceRefs, eventIds);
    if (test.support === "captured" && (test.exitCode === null || evidenceRefs.length === 0)) fail("captured 测试必须有退出码和事件依据");
    return { command, exitCode: test.exitCode as number | null, evidenceRefs, support: test.support as "captured" | "reported" };
  });
  const provenance = value.provenance;
  if (!record(provenance)) fail("记忆来源信息缺失");
  keys(provenance, new Set(["extractor", "promptVersion", "model", "createdAt", "editedBy", "usage"]), "记忆来源信息包含不支持的字段");
  if (!str(provenance.extractor) || !str(provenance.promptVersion) || !str(provenance.model) || !iso(provenance.createdAt) ||
      !(provenance.editedBy === null || str(provenance.editedBy)) || !record(provenance.usage)) fail("记忆来源信息无效");
  keys(provenance.usage, new Set(["inputTokens", "outputTokens"]), "模型用量包含不支持的字段");
  const usageValue = (candidate: unknown) => candidate === null || (Number.isSafeInteger(candidate) && (candidate as number) >= 0);
  if (!usageValue(provenance.usage.inputTokens) || !usageValue(provenance.usage.outputTokens)) fail("模型用量无效");
  return {
    schemaVersion: 1, id: str(value.id), sessionKey: str(value.sessionKey), projectId: str(value.projectId), taskId: str(value.taskId),
    parentMemoryId: value.parentMemoryId as string | null, revision: value.revision as number, inputDigest: str(value.inputDigest),
    sourceCoverage: coverage, code, ...items, tests,
    provenance: { extractor: str(provenance.extractor), promptVersion: str(provenance.promptVersion), model: str(provenance.model), createdAt: str(provenance.createdAt), editedBy: provenance.editedBy as string | null,
      usage: { inputTokens: provenance.usage.inputTokens as number | null, outputTokens: provenance.usage.outputTokens as number | null } },
  };
}

export function parseSessionMemoryManifestV1(value: unknown): SessionMemoryManifestV1 {
  if (!record(value) || value.schemaVersion !== 1) fail("会话包清单格式或版本无效");
  keys(value, new Set(["schemaVersion", "packageId", "sessionKey", "memoryId", "checkpointLocalId", "projectId", "taskId", "parentPackageId", "codeHeadSha", "taskHandoffVersion", "taskUpdatedAt", "sourceCoverage", "segments"]), "会话包清单包含不支持的字段");
  if (!UUID.test(str(value.packageId)) || !UUID.test(str(value.sessionKey)) || !UUID.test(str(value.memoryId)) || !UUID.test(str(value.checkpointLocalId)) ||
      !(value.parentPackageId === null || UUID.test(str(value.parentPackageId))) || value.parentPackageId === value.packageId) fail("会话包或父包 ID 无效");
  if (!str(value.projectId) || !str(value.taskId) || !GIT_SHA.test(str(value.codeHeadSha)) || !Number.isSafeInteger(value.taskHandoffVersion) || (value.taskHandoffVersion as number) < 1 || !iso(value.taskUpdatedAt)) fail("会话包项目、任务或代码基线无效");
  const sourceCoverage = parseCoverage(value.sourceCoverage);
  if (!Array.isArray(value.segments) || value.segments.length > 200) fail("事件片段数量无效");
  const segments = value.segments.map(parseSegment);
  const paths = new Set<string>(); const ids = new Set<string>();
  for (const segment of segments) {
    if (paths.has(segment.relativePath)) fail("事件片段路径重复");
    paths.add(segment.relativePath);
    if (new Set(segment.eventIds).size !== segment.eventIds.length || segment.eventIds.some((id) => ids.has(id))) fail("事件在片段中重复引用");
    segment.eventIds.forEach((id) => ids.add(id));
  }
  if (segments.length === 0 && sourceCoverage.fromSequence !== 0) fail("有事件覆盖范围却未包含事件片段");
  const min = segments.length ? Math.min(...segments.map((segment) => segment.fromSequence)) : 0;
  const max = segments.length ? Math.max(...segments.map((segment) => segment.toSequence)) : 0;
  if (min !== sourceCoverage.fromSequence || max !== sourceCoverage.toSequence) fail("清单覆盖范围与事件片段不一致");
  if (sourceCoverage.gaps.some((id) => !ids.has(id))) fail("清单缺口引用不在包内");
  return { schemaVersion: 1, packageId: str(value.packageId), sessionKey: str(value.sessionKey), memoryId: str(value.memoryId), checkpointLocalId: str(value.checkpointLocalId), projectId: str(value.projectId), taskId: str(value.taskId),
    parentPackageId: value.parentPackageId as string | null, codeHeadSha: str(value.codeHeadSha), taskHandoffVersion: value.taskHandoffVersion as number, taskUpdatedAt: str(value.taskUpdatedAt), sourceCoverage, segments };
}

export function parseSessionMemoryPackageV1(value: unknown, sha256: Sha256, context: SessionMemoryValidationContext = {}): SessionMemoryPackageV1 {
  if (!record(value) || value.format !== "agilecampus-session-memory" || value.schemaVersion !== 1) fail("会话记忆包格式或版本不受支持");
  keys(value, new Set(["format", "schemaVersion", "publicationCompleteness", "sharingReview", "manifest", "memory", "eventSegments", "sourceArchive", "archiveSegments"]), "会话记忆包包含不支持的字段");
  if (value.publicationCompleteness !== "complete" && value.publicationCompleteness !== "partial") fail("发布完整性状态不受支持");
  const manifest = parseSessionMemoryManifestV1(value.manifest);
  if (!Array.isArray(value.eventSegments) || value.eventSegments.length !== manifest.segments.length) fail("事件片段与清单不一致");
  const events: NormalizedEventV1[] = [];
  const segmentIds = new Set<string>();
  const eventSegments = value.eventSegments.map((raw) => {
    if (!record(raw)) fail("事件片段格式无效");
    keys(raw, new Set(["relativePath", "events"]), "事件片段包含不支持的字段");
    const relativePath = str(raw.relativePath);
    if (!relativePath || !Array.isArray(raw.events) || raw.events.length === 0) fail("事件片段为空或路径无效");
    const descriptor = manifest.segments.find((segment) => segment.relativePath === relativePath);
    if (!descriptor || segmentIds.has(relativePath)) fail("事件片段路径不在清单中或重复");
    segmentIds.add(relativePath);
    const parsedEvents = raw.events.map(parseNormalizedEventV1);
    const bytes = new TextEncoder().encode(JSON.stringify(parsedEvents));
    if (bytes.byteLength > SESSION_MEMORY_MAX_SEGMENT_BYTES || bytes.byteLength !== descriptor.byteLength || sha256(bytes).toLowerCase() !== descriptor.sha256) fail("事件片段大小或 SHA-256 校验失败");
    if (parsedEvents.some((event) => event.sessionKey !== manifest.sessionKey || event.sourceRef !== `${relativePath}#${event.id}`)) fail("事件会话或分享来源引用与清单不匹配");
    if (JSON.stringify(parsedEvents.map((event) => event.id)) !== JSON.stringify(descriptor.eventIds) || parsedEvents[0].sequence !== descriptor.fromSequence || parsedEvents[parsedEvents.length - 1].sequence !== descriptor.toSequence) fail("事件片段引用或序号范围与清单不一致");
    parsedEvents.forEach((event) => events.push(event));
    return { relativePath, events: parsedEvents };
  });
  if (segmentIds.size !== manifest.segments.length) fail("清单存在未包含的事件片段");
  if (events.length > SESSION_MEMORY_MAX_EVENTS) fail("事件总量超过限制");
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  if (new Set(ordered.map((event) => event.id)).size !== ordered.length || ordered.some((event, index) => index > 0 && event.sequence <= ordered[index - 1].sequence)) fail("事件序号或 ID 重复");
  if (ordered.some((event, index) => index > 0 && event.sequence !== ordered[index - 1].sequence + 1)) fail("事件序号存在未记录的覆盖缺口");
  if (JSON.stringify(events.map((event) => event.id)) !== JSON.stringify(ordered.map((event) => event.id))) fail("事件片段顺序必须与事件序号一致");
  const eventIds = new Set(ordered.map((event) => event.id));
  const gaps = new Set(ordered.filter((event) => event.kind === "gap").map((event) => event.id));
  if (manifest.sourceCoverage.gaps.length !== gaps.size || manifest.sourceCoverage.gaps.some((id) => !gaps.has(id))) fail("覆盖缺口必须完整引用包内 gap 事件");
  const memory = parseMemoryDocumentV1(value.memory, eventIds);
  if (memory.id !== manifest.memoryId || memory.sessionKey !== manifest.sessionKey || memory.projectId !== manifest.projectId || memory.taskId !== manifest.taskId ||
      memory.code.headSha.toLowerCase() !== manifest.codeHeadSha.toLowerCase() ||
      memory.sourceCoverage.fromSequence !== manifest.sourceCoverage.fromSequence || memory.sourceCoverage.toSequence !== manifest.sourceCoverage.toSequence || JSON.stringify(memory.sourceCoverage.gaps) !== JSON.stringify(manifest.sourceCoverage.gaps)) fail("记忆文档与清单的范围不一致");
  if (manifest.parentPackageId) {
    if (!context.parent || context.parent.packageId !== manifest.parentPackageId || context.parent.memoryId !== memory.parentMemoryId || context.parent.projectId !== manifest.projectId || context.parent.taskId !== manifest.taskId || context.parent.revision >= memory.revision) fail("父包缺失、跨项目/任务或引用了未来记忆版本");
  } else if (memory.parentMemoryId !== null) fail("记忆文档声明了未登记的父记忆");
  if (context.ancestors?.some((ancestor) => ancestor.packageId === manifest.packageId || ancestor.memoryId === memory.id)) {
    fail("会话包父子关系形成循环");
  }
  const archiveRequiredEventIds = new Set(ordered.filter((event) => event.kind === "user" || event.kind === "assistant" || event.kind === "tool_call" || event.kind === "tool_result").map((event) => event.id));
  const archive = parseSourceArchive(value.sourceArchive, value.archiveSegments, eventIds, archiveRequiredEventIds, sha256);
  // Memory evidence can point to a normalized event even when an explicitly partial archive has no matching transcript record.
  // Consumers resolve the event first, then check eventRanges/unmappedEvents to decide whether an original-text jump exists.
  if (value.publicationCompleteness === "complete" && archive.sourceArchive.status !== "complete") fail("原文档案不完整，不能标记为完整发布");
  const review = parseSharingReview(value.sharingReview);
  if (!review.confirmed || !review.confirmedAt || !iso(review.confirmedAt)) fail("分享内容未经预览和用户确认");
  const packageWithoutReview = {
    format: "agilecampus-session-memory" as const, schemaVersion: 1 as const,
    publicationCompleteness: value.publicationCompleteness as "complete" | "partial", manifest, memory, eventSegments,
    sourceArchive: archive.sourceArchive, archiveSegments: archive.archiveSegments,
  };
  if (review.previewDigest !== computeSessionMemoryReviewDigest(packageWithoutReview, sha256)) fail("分享预览已过期；内容与确认时不同");
  const packageValue: SessionMemoryPackageV1 = { ...packageWithoutReview, sharingReview: review };
  if (new TextEncoder().encode(JSON.stringify(packageValue)).byteLength > SESSION_MEMORY_MAX_PACKAGE_BYTES) fail("会话记忆包超过 10 MiB");
  return packageValue;
}

export function createSessionMemoryPackageV1(input: {
  manifest: Omit<SessionMemoryManifestV1, "segments" | "sourceCoverage">;
  memory: MemoryDocumentV1;
  events: NormalizedEventV1[];
  gaps?: string[];
  publicationCompleteness: "complete" | "partial";
  sharingReview: { confirmed: boolean; confirmedAt: string | null };
  sourceArchive: SourceArchiveBuildInput;
}, sha256: Sha256): SessionMemoryPackageV1 {
  if (input.events.length === 0) fail("会话记忆包至少需要一个事件");
  const sorted = [...input.events].map(parseNormalizedEventV1).sort((a, b) => a.sequence - b.sequence);
  const batches: NormalizedEventV1[][] = [];
  let batch: NormalizedEventV1[] = [];
  for (const event of sorted) {
    const candidate = [...batch, event];
    const size = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
    if (size > SESSION_MEMORY_MAX_SEGMENT_BYTES) {
      if (batch.length === 0) fail("单个事件超过 256 KiB，不能加入会话包");
      batches.push(batch); batch = [event];
      if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > SESSION_MEMORY_MAX_SEGMENT_BYTES) fail("单个事件超过 256 KiB，不能加入会话包");
    } else batch = candidate;
  }
  if (batch.length) batches.push(batch);
  const eventSegments = batches.map((batch, index) => {
    const relativePath = `events/${String(index + 1).padStart(6, "0")}.json`;
    const events = batch.map((event) => ({ ...event, sourceRef: `${relativePath}#${event.id}` }));
    return { relativePath, events };
  });
  const all = eventSegments.flatMap((segment) => segment.events);
  const sourceCoverage = { fromSequence: all[0].sequence, toSequence: all[all.length - 1].sequence, gaps: input.gaps ?? [] };
  const segments: SessionMemorySegmentV1[] = eventSegments.map((segment) => {
    const bytes = new TextEncoder().encode(JSON.stringify(segment.events));
    return { relativePath: segment.relativePath, sha256: sha256(bytes).toLowerCase(), byteLength: bytes.byteLength, fromSequence: segment.events[0].sequence, toSequence: segment.events[segment.events.length - 1].sequence, eventIds: segment.events.map((event) => event.id) };
  });
  const manifest = parseSessionMemoryManifestV1({ ...input.manifest, sourceCoverage, segments });
  const memory = parseMemoryDocumentV1(input.memory, new Set(all.map((event) => event.id)));
  const archiveSegments = input.sourceArchive.segments.map((segment) => ({ relativePath: segment.relativePath, encoding: "base64" as const, data: encodeBase64(segment.content) }));
  const sourceArchive = buildSourceArchive(input.sourceArchive, sha256);
  const draft = { format: "agilecampus-session-memory" as const, schemaVersion: 1 as const, publicationCompleteness: input.publicationCompleteness,
    manifest, memory, eventSegments, sourceArchive, archiveSegments };
  const previewDigest = computeSessionMemoryReviewDigest(draft, sha256);
  return parseSessionMemoryPackageV1({ ...draft, sharingReview: { ...input.sharingReview, previewDigest } }, sha256);
}

export function computeSessionMemoryReviewDigest(value: unknown, sha256: Sha256): string {
  if (!record(value)) fail("分享预览内容无效");
  const projection = {
    format: value.format, schemaVersion: value.schemaVersion, publicationCompleteness: value.publicationCompleteness,
    manifest: value.manifest, memory: value.memory, eventSegments: value.eventSegments,
    sourceArchive: value.sourceArchive, archiveSegments: value.archiveSegments,
  };
  return sha256(new TextEncoder().encode(stableStringify(projection))).toLowerCase();
}

function parseSharingReview(value: unknown): SessionMemoryPackageV1["sharingReview"] {
  if (!record(value)) fail("分享预览确认信息缺失");
  keys(value, new Set(["confirmed", "confirmedAt", "previewDigest"]), "分享预览确认包含不支持字段");
  if (typeof value.confirmed !== "boolean" || !(value.confirmedAt === null || iso(value.confirmedAt)) || !HASH.test(str(value.previewDigest))) fail("分享预览确认信息无效");
  return { confirmed: value.confirmed, confirmedAt: value.confirmedAt as string | null, previewDigest: str(value.previewDigest).toLowerCase() };
}

function parseSourceArchive(
  value: unknown,
  rawSegments: unknown,
  eventIds: ReadonlySet<string>,
  archiveRequiredEventIds: ReadonlySet<string>,
  sha256: Sha256,
): { sourceArchive: SourceArchiveV1; archiveSegments: SessionMemoryPackageV1["archiveSegments"] } {
  if (!record(value) || value.schemaVersion !== 1) fail("原文档案格式或版本无效");
  keys(value, new Set(["schemaVersion", "status", "provider", "providerVersion", "adapter", "adapterVersion", "parserVersion", "encoding", "compression", "integrityStatus", "sourceByteLength", "publishedDigest", "publishedByteLength", "reachedEof", "truncationDetected", "formatRecognized", "gaps", "redaction", "segments", "eventRanges", "unmappedEvents"]), "原文档案包含不支持的字段");
  if (!(value.status === "complete" || value.status === "partial" || value.status === "unavailable") ||
      !archiveLabel(value.provider) || !archiveLabel(value.providerVersion) || !archiveLabel(value.adapter) || !archiveLabel(value.adapterVersion)) fail("原文档案来源或状态无效；不接受本机路径或原生会话标识");
  if (value.parserVersion !== SESSION_MEMORY_ARCHIVE_PARSER_V1) fail("原文档案 parserVersion 未知；必须由受支持的 parser 重新预览");
  if (value.encoding !== "utf-8" || value.compression !== "none") fail("当前只支持未压缩 UTF-8 原文档案");
  if (!(["verified", "partial", "unavailable"] as const).includes(value.integrityStatus as "verified" | "partial" | "unavailable") ||
      typeof value.reachedEof !== "boolean" || typeof value.truncationDetected !== "boolean" || typeof value.formatRecognized !== "boolean") fail("原文档案完整性状态无效");
  const sourceLength = value.sourceByteLength;
  const publishedLength = value.publishedByteLength;
  if (!(sourceLength === null || (Number.isSafeInteger(sourceLength) && (sourceLength as number) >= 0 && (sourceLength as number) <= SESSION_MEMORY_MAX_SOURCE_BYTES)) ||
      !Number.isSafeInteger(publishedLength) || (publishedLength as number) < 0 || (publishedLength as number) > SESSION_MEMORY_MAX_ARCHIVE_BYTES) fail("原文档案长度超出限制");
  if (!(value.publishedDigest === null || HASH.test(str(value.publishedDigest)))) fail("原文档案摘要无效");
  if (!Array.isArray(value.segments) || value.segments.length > 40 || !Array.isArray(rawSegments) || rawSegments.length !== value.segments.length) fail("原文档案分片缺失或数量无效");
  if (!Array.isArray(value.gaps) || value.gaps.length > 1000) fail("原文档案缺口范围无效");
  const gaps = value.gaps.map((gap) => parseArchiveGap(gap, sourceLength));
  const redaction = parseArchiveRedaction(value.redaction, sourceLength, publishedLength as number);
  if (!Array.isArray(value.eventRanges) || value.eventRanges.length > SESSION_MEMORY_MAX_EVENTS * 4) fail("原文档案事件范围数量无效");
  const eventRanges = value.eventRanges.map((range) => parseArchiveEventRange(range, eventIds, sourceLength, publishedLength as number));
  if (!Array.isArray(value.unmappedEvents) || value.unmappedEvents.length > SESSION_MEMORY_MAX_EVENTS) fail("原文档案未映射事件清单无效");
  const unmappedEvents = value.unmappedEvents.map((item) => parseUnmappedArchiveEvent(item, archiveRequiredEventIds));
  const eventRangeIds = new Set<string>();
  const archiveRecordIds = new Set<string>();
  for (const range of eventRanges) {
    if (eventRangeIds.has(range.eventId) || archiveRecordIds.has(range.archiveRecordId)) fail("原文事件映射或归档记录 ID 重复");
    eventRangeIds.add(range.eventId);
    archiveRecordIds.add(range.archiveRecordId);
  }
  const unmappedEventIds = new Set<string>();
  for (const item of unmappedEvents) {
    if (unmappedEventIds.has(item.eventId) || eventRangeIds.has(item.eventId)) fail("原文事件不能同时映射和声明未映射，也不能重复");
    unmappedEventIds.add(item.eventId);
  }
  const segments: SourceArchiveSegmentV1[] = [];
  const archiveSegments: SessionMemoryPackageV1["archiveSegments"] = [];
  const segmentPaths = new Set<string>();
  let publishedOffset = 0;
  let aggregateByteLength = 0;
  const publishedChunks: Uint8Array[] = [];
  for (let index = 0; index < value.segments.length; index += 1) {
    const descriptor = parseArchiveSegment(value.segments[index]);
    const raw = rawSegments[index];
    if (!record(raw)) fail("原文档案分片内容无效");
    keys(raw, new Set(["relativePath", "encoding", "data"]), "原文档案分片包含不支持的字段");
    if (raw.relativePath !== descriptor.relativePath || raw.encoding !== "base64" || typeof raw.data !== "string" || segmentPaths.has(descriptor.relativePath)) fail("原文档案分片路径或编码无效");
    segmentPaths.add(descriptor.relativePath);
    const bytes = decodeBase64(raw.data);
    if (bytes.byteLength === 0 || bytes.byteLength > SESSION_MEMORY_MAX_ARCHIVE_SEGMENT_BYTES || bytes.byteLength !== descriptor.byteLength || sha256(bytes).toLowerCase() !== descriptor.sha256) fail("原文档案分片缺失、截断或 SHA-256 校验失败");
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { fail("原文档案分片不是有效 UTF-8"); }
    if (descriptor.publishedStartByte !== publishedOffset || descriptor.publishedEndByte - descriptor.publishedStartByte !== bytes.byteLength) fail("原文档案发布字节范围不连续");
    publishedOffset = descriptor.publishedEndByte;
    aggregateByteLength += bytes.byteLength;
    if (aggregateByteLength > SESSION_MEMORY_MAX_ARCHIVE_BYTES) fail("原文档案总量超过 5 MiB；必须保留本地并停止完整发布");
    publishedChunks.push(bytes);
    segments.push(descriptor);
    archiveSegments.push({ relativePath: descriptor.relativePath, encoding: "base64", data: raw.data });
  }
  if (segmentPaths.size !== value.segments.length || publishedOffset !== publishedLength || aggregateByteLength !== publishedLength) fail("原文档案分片总长度不一致");
  const publishedBytes = concatBytes(publishedChunks, aggregateByteLength);
  if (publishedLength > 0 && (value.publishedDigest === null || sha256(publishedBytes).toLowerCase() !== str(value.publishedDigest).toLowerCase())) fail("原文档案发布字节摘要不匹配");
  if (publishedLength === 0 && (segments.length > 0 || value.publishedDigest !== null)) fail("空原文档案摘要状态无效");
  const sourceIntervals = [
    ...segments.map((item) => ({ startByte: item.sourceStartByte, endByte: item.sourceEndByte })),
    ...gaps.map(({ startByte, endByte }) => ({ startByte, endByte })),
    ...redaction.excludedRanges,
  ].sort((left, right) => left.startByte - right.startByte);
  if (sourceLength !== null) {
    let cursor = 0;
    for (const range of sourceIntervals) {
      if (range.startByte !== cursor) fail("原文档案源字节范围存在未声明缺口或重叠");
      cursor = range.endByte;
    }
    if (cursor !== sourceLength) fail("原文档案未覆盖来源字节末尾，不能静默截断");
  } else if (sourceIntervals.length > 0) fail("来源长度未知时不能声明原文范围");
  if (value.status === "complete") {
    if (value.integrityStatus !== "verified" || sourceLength === null || !HASH.test(str(value.publishedDigest)) || unmappedEvents.length > 0 ||
        !value.reachedEof || value.truncationDetected || !value.formatRecognized || gaps.length || redaction.excludedRanges.length ||
        aggregateByteLength === 0 || sourceIntervals.some((item, index) => index > 0 && sourceIntervals[index - 1].endByte !== item.startByte)) fail("原文档案不完整，不能标记为完整");
  } else if (value.status === "partial") {
    if (value.integrityStatus !== "partial" || sourceLength === null || (!gaps.length && !redaction.excludedRanges.length && !unmappedEvents.length && !value.truncationDetected && value.reachedEof && value.formatRecognized)) fail("部分原文档案必须明确记录缺口、未映射事件或截断原因");
  } else {
    if (value.integrityStatus !== "unavailable" || sourceLength !== null || value.publishedDigest !== null || publishedLength !== 0 || segments.length !== 0 || eventRanges.length !== 0 || gaps.length || redaction.excludedRanges.length || redaction.redactedRanges.length) fail("不可用原文档案不能携带未验证内容");
  }
  if (value.status === "complete" && [...archiveRequiredEventIds].some((id) => !eventRangeIds.has(id))) {
    fail("完整原文档案必须映射全部对话事件");
  }
  if (value.status !== "complete" && [...archiveRequiredEventIds].some((id) => !eventRangeIds.has(id) && !unmappedEventIds.has(id))) {
    fail("部分/不可用原文档案必须逐条说明未映射对话事件");
  }
  if ([...unmappedEventIds].some((id) => !archiveRequiredEventIds.has(id))) {
    fail("只有对话事件可以列为未映射原文事件");
  }
  if (publishedLength > 0 && (!redaction.confirmed || !redaction.confirmedAt || !redaction.previewDigest || redaction.previewDigest.toLowerCase() !== str(value.publishedDigest).toLowerCase())) fail("原文档案未经脱敏预览和用户确认");
  if (redaction.redactedRanges.some((range) => !segments.some((segment) => containsRange(segment.sourceStartByte, segment.sourceEndByte, range.sourceStartByte, range.sourceEndByte)) ||
      !segments.some((segment) => containsRange(segment.publishedStartByte, segment.publishedEndByte, range.publishedStartByte, range.publishedEndByte)))) fail("脱敏范围不在已发布分片内");
  if (eventRanges.some((range) => !segments.some((segment) => containsRange(segment.sourceStartByte, segment.sourceEndByte, range.sourceStartByte, range.sourceEndByte)) ||
      !segments.some((segment) => containsRange(segment.publishedStartByte, segment.publishedEndByte, range.publishedStartByte, range.publishedEndByte)))) fail("事件证据范围无法定位到原文分片");
  const sourceArchive: SourceArchiveV1 = {
    schemaVersion: 1, status: value.status, provider: str(value.provider), providerVersion: str(value.providerVersion), adapter: str(value.adapter), adapterVersion: str(value.adapterVersion), parserVersion: SESSION_MEMORY_ARCHIVE_PARSER_V1,
    encoding: "utf-8", compression: "none", integrityStatus: value.integrityStatus as SourceArchiveV1["integrityStatus"], sourceByteLength: sourceLength as number | null,
    publishedDigest: value.publishedDigest as string | null, publishedByteLength: publishedLength as number, reachedEof: value.reachedEof, truncationDetected: value.truncationDetected, formatRecognized: value.formatRecognized,
    gaps, redaction, segments, eventRanges, unmappedEvents,
  };
  return { sourceArchive, archiveSegments };
}

function buildSourceArchive(input: SourceArchiveBuildInput, sha256: Sha256): SourceArchiveV1 {
  const { segments: sourceSegments, ...metadata } = input;
  const segments: SourceArchiveSegmentV1[] = [];
  const allBytes: Uint8Array[] = [];
  let totalBytes = 0;
  let publishedOffset = 0;
  for (const item of sourceSegments) {
    const bytes = Uint8Array.from(item.content);
    segments.push({ relativePath: item.relativePath, sha256: sha256(bytes).toLowerCase(), byteLength: bytes.byteLength,
      sourceStartByte: item.sourceStartByte, sourceEndByte: item.sourceEndByte, publishedStartByte: publishedOffset, publishedEndByte: publishedOffset + bytes.byteLength });
    allBytes.push(bytes);
    totalBytes += bytes.byteLength;
    publishedOffset += bytes.byteLength;
  }
  const publishedDigest = totalBytes ? sha256(concatBytes(allBytes, totalBytes)).toLowerCase() : null;
  const redaction = input.redaction.confirmed && input.redaction.previewDigest === null ? { ...input.redaction, previewDigest: publishedDigest } : input.redaction;
  return { ...metadata, redaction, publishedDigest, publishedByteLength: publishedOffset, segments };
}

function parseArchiveSegment(value: unknown): SourceArchiveSegmentV1 {
  if (!record(value)) fail("原文档案分片描述无效");
  keys(value, new Set(["relativePath", "sha256", "byteLength", "sourceStartByte", "sourceEndByte", "publishedStartByte", "publishedEndByte"]), "原文档案分片描述包含不支持字段");
  const relativePath = str(value.relativePath);
  if (!safeRelativePath(relativePath) || !relativePath.startsWith("source/") || !HASH.test(str(value.sha256)) ||
      !integerAtLeast(value.byteLength, 1) || (value.byteLength as number) > SESSION_MEMORY_MAX_ARCHIVE_SEGMENT_BYTES ||
      !integerAtLeast(value.sourceStartByte, 0) || !integerAtLeast(value.sourceEndByte, 1) || (value.sourceEndByte as number) <= (value.sourceStartByte as number) ||
      !integerAtLeast(value.publishedStartByte, 0) || !integerAtLeast(value.publishedEndByte, 1) || (value.publishedEndByte as number) <= (value.publishedStartByte as number) ||
      (value.publishedEndByte as number) - (value.publishedStartByte as number) !== value.byteLength) fail("原文档案分片描述或长度无效");
  return { relativePath, sha256: str(value.sha256).toLowerCase(), byteLength: value.byteLength as number, sourceStartByte: value.sourceStartByte as number, sourceEndByte: value.sourceEndByte as number, publishedStartByte: value.publishedStartByte as number, publishedEndByte: value.publishedEndByte as number };
}

function parseArchiveGap(value: unknown, sourceLength: unknown): SourceArchiveV1["gaps"][number] {
  if (!record(value)) fail("原文档案缺口无效");
  keys(value, new Set(["startByte", "endByte", "reason"]), "原文档案缺口包含不支持字段");
  if (!integerAtLeast(value.startByte, 0) || !integerAtLeast(value.endByte, 1) || (value.endByte as number) <= (value.startByte as number) || !str(value.reason) || sourceLength === null || (value.endByte as number) > (sourceLength as number)) fail("原文档案缺口范围无效");
  return { startByte: value.startByte as number, endByte: value.endByte as number, reason: str(value.reason) };
}

function parseArchiveRedaction(value: unknown, sourceLength: unknown, publishedLength: number): SourceArchiveV1["redaction"] {
  if (!record(value)) fail("原文档案脱敏记录缺失");
  keys(value, new Set(["confirmed", "confirmedAt", "previewDigest", "redactedRanges", "excludedRanges", "redactedByteCount", "excludedByteCount"]), "原文档案脱敏记录包含不支持字段");
  if (typeof value.confirmed !== "boolean" || !(value.confirmedAt === null || iso(value.confirmedAt)) || !(value.previewDigest === null || HASH.test(str(value.previewDigest))) ||
      !Array.isArray(value.redactedRanges) || !Array.isArray(value.excludedRanges) || !integerAtLeast(value.redactedByteCount, 0) || !integerAtLeast(value.excludedByteCount, 0)) fail("原文档案脱敏记录无效");
  const redactedRanges = value.redactedRanges.map((item) => {
    if (!record(item)) fail("脱敏范围无效");
    keys(item, new Set(["sourceStartByte", "sourceEndByte", "publishedStartByte", "publishedEndByte", "category"]), "脱敏范围包含不支持字段");
    if (!integerAtLeast(item.sourceStartByte, 0) || !integerAtLeast(item.sourceEndByte, 1) || (item.sourceEndByte as number) <= (item.sourceStartByte as number) || (sourceLength !== null && (item.sourceEndByte as number) > (sourceLength as number)) ||
        !integerAtLeast(item.publishedStartByte, 0) || !integerAtLeast(item.publishedEndByte, 1) || (item.publishedEndByte as number) <= (item.publishedStartByte as number) || (item.publishedEndByte as number) > publishedLength || !str(item.category)) fail("脱敏范围无效");
    return { sourceStartByte: item.sourceStartByte as number, sourceEndByte: item.sourceEndByte as number, publishedStartByte: item.publishedStartByte as number, publishedEndByte: item.publishedEndByte as number, category: str(item.category) };
  });
  const excludedRanges = value.excludedRanges.map((item) => parseByteRange(item, sourceLength));
  assertNoOverlap(redactedRanges.map((item) => ({ startByte: item.sourceStartByte, endByte: item.sourceEndByte })));
  assertNoOverlap(redactedRanges.map((item) => ({ startByte: item.publishedStartByte, endByte: item.publishedEndByte })));
  assertNoOverlap(excludedRanges);
  const redactedByteCount = redactedRanges.reduce((sum, item) => sum + item.sourceEndByte - item.sourceStartByte, 0);
  const excludedByteCount = excludedRanges.reduce((sum, item) => sum + item.endByte - item.startByte, 0);
  if (value.redactedByteCount !== redactedByteCount || value.excludedByteCount !== excludedByteCount) fail("脱敏统计与范围不一致");
  if (redactedRanges.length > 0 && (!value.confirmed || !value.confirmedAt || !iso(value.confirmedAt) || !HASH.test(str(value.previewDigest)))) fail("原文档案脱敏未预览并确认");
  if (excludedRanges.length > 0 && !value.confirmed) fail("排除原文范围必须经用户确认");
  return { confirmed: value.confirmed, confirmedAt: value.confirmedAt as string | null, previewDigest: value.previewDigest as string | null,
    redactedRanges, excludedRanges, redactedByteCount, excludedByteCount };
}

function parseArchiveEventRange(value: unknown, eventIds: ReadonlySet<string>, sourceLength: unknown, publishedLength: number): SourceArchiveEventRangeV1 {
  if (!record(value)) fail("原文事件范围无效");
  keys(value, new Set(["eventId", "archiveRecordId", "sourceStartByte", "sourceEndByte", "publishedStartByte", "publishedEndByte"]), "原文事件范围包含不支持字段");
  if (!UUID.test(str(value.eventId)) || !eventIds.has(str(value.eventId)) || !UUID.test(str(value.archiveRecordId)) || !integerAtLeast(value.sourceStartByte, 0) || !integerAtLeast(value.sourceEndByte, 1) ||
      (value.sourceEndByte as number) <= (value.sourceStartByte as number) || (sourceLength !== null && (value.sourceEndByte as number) > (sourceLength as number)) ||
      !integerAtLeast(value.publishedStartByte, 0) || !integerAtLeast(value.publishedEndByte, 1) || (value.publishedEndByte as number) <= (value.publishedStartByte as number) || (value.publishedEndByte as number) > publishedLength) fail("原文事件范围无效或事件不存在");
  return { eventId: str(value.eventId), archiveRecordId: str(value.archiveRecordId), sourceStartByte: value.sourceStartByte as number, sourceEndByte: value.sourceEndByte as number, publishedStartByte: value.publishedStartByte as number, publishedEndByte: value.publishedEndByte as number };
}

function parseUnmappedArchiveEvent(value: unknown, archiveRequiredEventIds: ReadonlySet<string>): { eventId: string; reason: string } {
  if (!record(value)) fail("未映射原文事件说明无效");
  keys(value, new Set(["eventId", "reason"]), "未映射原文事件说明包含不支持字段");
  const eventId = str(value.eventId);
  const reason = str(value.reason).trim();
  if (!UUID.test(eventId) || !archiveRequiredEventIds.has(eventId) || !reason || reason.length > 240 || /[\\/]|(?:^|\s)~(?:\/|\\)|\b(?:Users|home|private|tmp)\b/i.test(reason)) fail("未映射原文事件必须是已知对话事件且说明安全、具体");
  return { eventId, reason };
}

function parseByteRange(value: unknown, sourceLength: unknown): { startByte: number; endByte: number } {
  if (!record(value) || !integerAtLeast(value.startByte, 0) || !integerAtLeast(value.endByte, 1) || (value.endByte as number) <= (value.startByte as number) || (sourceLength !== null && (value.endByte as number) > (sourceLength as number))) fail("来源字节范围无效");
  keys(value, new Set(["startByte", "endByte"]), "来源字节范围包含不支持字段");
  return { startByte: value.startByte as number, endByte: value.endByte as number };
}

function assertNoOverlap(ranges: Array<{ startByte: number; endByte: number }>): void {
  const sorted = [...ranges].sort((a, b) => a.startByte - b.startByte);
  if (sorted.some((range, index) => index > 0 && range.startByte < sorted[index - 1].endByte)) fail("原文字节范围重叠");
}

function containsRange(start: number, end: number, innerStart: number, innerEnd: number): boolean { return innerStart >= start && innerEnd <= end; }
function integerAtLeast(value: unknown, minimum: number): boolean { return Number.isSafeInteger(value) && (value as number) >= minimum; }
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  return btoa(binary);
}
function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (encodeBase64(bytes) !== value) fail("原文档案分片 base64 编码无效");
    return bytes;
  } catch { return fail("原文档案分片 base64 编码无效"); }
}
function concatBytes(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function parseMemoryItem(value: unknown, ids: Set<string>, eventIds?: ReadonlySet<string>): MemoryItemV1 {
  if (!record(value)) fail("记忆条目格式无效");
  keys(value, new Set(["id", "text", "evidenceRefs", "origin", "support", "disposition", "supersedes"]), "记忆条目包含不支持的字段");
  const id = str(value.id); const text = str(value.text);
  if (!UUID.test(id) || ids.has(id) || !text || text.length > 16_384) fail("记忆条目 ID 或正文无效");
  ids.add(id);
  if (value.origin !== "extracted" && value.origin !== "human") fail("记忆条目来源不受支持");
  if (!isSupport(value.support)) fail("记忆条目 support 不受支持");
  if (value.disposition !== "active" && value.disposition !== "superseded" && value.disposition !== "uncertain") fail("记忆条目状态不受支持");
  if (value.supersedes !== undefined && (!UUID.test(str(value.supersedes)) || value.supersedes === value.id)) fail("被替代条目引用无效");
  const evidenceRefs = parseRefs(value.evidenceRefs, eventIds);
  if (value.support === "captured" && evidenceRefs.length === 0) fail("captured 记忆条目必须包含事件依据");
  return { id, text, evidenceRefs, origin: value.origin, support: value.support as MemorySupport, disposition: value.disposition,
    ...(value.supersedes !== undefined ? { supersedes: str(value.supersedes) } : {}) };
}

function parseSegment(value: unknown): SessionMemorySegmentV1 {
  if (!record(value)) fail("事件片段描述无效");
  keys(value, new Set(["relativePath", "sha256", "byteLength", "fromSequence", "toSequence", "eventIds"]), "事件片段描述包含不支持的字段");
  if (!safeRelativePath(str(value.relativePath)) || !str(value.relativePath).startsWith("events/") || !HASH.test(str(value.sha256)) ||
      !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1 || (value.byteLength as number) > SESSION_MEMORY_MAX_SEGMENT_BYTES ||
      !Number.isSafeInteger(value.fromSequence) || !Number.isSafeInteger(value.toSequence) || (value.fromSequence as number) < 1 || (value.toSequence as number) < (value.fromSequence as number) || !stringArray(value.eventIds) || value.eventIds.length === 0 || value.eventIds.some((id) => !UUID.test(id))) fail("事件片段范围、hash 或大小无效");
  return { relativePath: str(value.relativePath), sha256: str(value.sha256).toLowerCase(), byteLength: value.byteLength as number, fromSequence: value.fromSequence as number, toSequence: value.toSequence as number, eventIds: value.eventIds as string[] };
}

function parseCoverage(value: unknown) {
  if (!record(value)) fail("事件覆盖范围无效");
  keys(value, new Set(["fromSequence", "toSequence", "gaps"]), "事件覆盖范围包含不支持的字段");
  if (!Number.isSafeInteger(value.fromSequence) || !Number.isSafeInteger(value.toSequence) || (value.fromSequence as number) < 0 || (value.toSequence as number) < (value.fromSequence as number) || !stringArray(value.gaps) || value.gaps.some((id) => !UUID.test(id)) || new Set(value.gaps).size !== value.gaps.length) fail("事件覆盖范围无效");
  return { fromSequence: value.fromSequence as number, toSequence: value.toSequence as number, gaps: value.gaps as string[] };
}

function parseRefs(value: unknown, eventIds?: ReadonlySet<string>): string[] {
  if (!stringArray(value) || value.some((id) => !UUID.test(id)) || new Set(value).size !== value.length) fail("证据引用列表无效或重复");
  if (eventIds && value.some((id) => !eventIds.has(id))) fail("证据引用不存在于分享包");
  return value as string[];
}
function isSupport(value: unknown): value is MemorySupport { return value === "captured" || value === "reported" || value === "inferred"; }
function safeRelativePath(value: string): boolean { return !!value && value.length < 512 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => !part || part === "." || part === ".."); }
function archiveLabel(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(value); }
function iso(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function str(value: unknown): string { return typeof value === "string" && value.trim().length > 0 ? value : ""; }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>, error: string): void { if (Object.keys(value).some((key) => !allowed.has(key))) fail(error); }
function fail(message: string): never { throw new SessionMemorySchemaError(message); }
