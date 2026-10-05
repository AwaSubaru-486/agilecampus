import type { NormalizedEventV1 } from "../../../shared/session-memory/types";
import { parseExtractionSnapshot, sha256, stableStringify } from "./input-snapshot";
import {
  MEMORY_INPUT_BUDGET_VERSION,
  MEMORY_INPUT_MAX_EVENT_TEXT_BYTES,
  MEMORY_INPUT_MAX_TEXT_BYTES,
  MEMORY_REDACTION_VERSION,
  type ExtractionPreview,
  type ExtractionSnapshotV1,
  type PreparedEventV1,
  type PreparedExtractionInputV1,
} from "./types";
import { redactSensitiveText } from "./redaction";

const DEFAULT_PROMPT_VERSION = "memory-extract-v1";
const MAX_SERIALIZED_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_EVENTS = 500;

export class MemoryInputError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "MemoryInputError"; }
}

type SanitizedEvent = { event: NormalizedEventV1; text: string; command?: string; toolCallId?: string; paths?: string[]; redacted: boolean; originalBytes: number };

export function prepareExtractionInput(
  inputSnapshot: ExtractionSnapshotV1,
  options: { promptVersion?: string } = {},
): PreparedExtractionInputV1 {
  const snapshot = parseExtractionSnapshot(inputSnapshot);
  const promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
  if (!promptVersion.trim() || promptVersion.length > 100) throw new MemoryInputError("INVALID_POLICY", "提炼版本无效");

  const toolCallIds = new Map<string, string>();
  const sanitized: SanitizedEvent[] = snapshot.events.map((event) => {
    const text = redactSensitiveText(event.text);
    const command = event.command === undefined ? undefined : redactSensitiveText(event.command);
    let toolCallId: string | undefined;
    if (event.toolCallId !== undefined) {
      toolCallId = toolCallIds.get(event.toolCallId);
      if (!toolCallId) { toolCallId = `tool-${toolCallIds.size + 1}`; toolCallIds.set(event.toolCallId, toolCallId); }
    }
    const paths = event.paths?.map((item) => redactSensitiveText(item));
    return {
      event,
      text: text.text,
      ...(command ? { command: command.text } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(paths ? { paths: paths.map((item) => item.text) } : {}),
      redacted: text.redacted || (command?.redacted ?? false) || (paths?.some((item) => item.redacted) ?? false),
      originalBytes: Buffer.byteLength(text.text),
    };
  });

  let remainingTextBytes = MEMORY_INPUT_MAX_TEXT_BYTES;
  let serializedBytes = 0;
  let redactedCount = 0;
  const selected = new Map<string, PreparedEventV1>();
  const omissions: PreparedExtractionInputV1["omissions"] = [];
  for (let index = sanitized.length - 1; index >= 0; index -= 1) {
    const item = sanitized[index];
    if (selected.size >= MAX_MODEL_EVENTS) {
      omissions.push({ eventId: item.event.id, sequence: item.event.sequence, reason: "budget", originalTextBytes: item.originalBytes });
      continue;
    }
    const base = preparedBase(item.event, item.command, item.toolCallId, item.paths);
    const baseBytes = Buffer.byteLength(JSON.stringify({ ...base, text: "", wasTruncated: false, originalTextBytes: item.originalBytes }));
    if (baseBytes + serializedBytes > MAX_SERIALIZED_INPUT_BYTES) {
      omissions.push({ eventId: item.event.id, sequence: item.event.sequence, reason: "budget", originalTextBytes: item.originalBytes });
      continue;
    }

    const normalizedText = truncateUtf8(item.text, Math.min(remainingTextBytes, MEMORY_INPUT_MAX_EVENT_TEXT_BYTES));
    const keptBytes = Buffer.byteLength(normalizedText);
    const wasTruncated = keptBytes < item.originalBytes;
    const prepared: PreparedEventV1 = { ...base, text: normalizedText, wasTruncated, originalTextBytes: item.originalBytes };
    const eventBytes = Buffer.byteLength(JSON.stringify(prepared));
    if (serializedBytes + eventBytes > MAX_SERIALIZED_INPUT_BYTES) {
      omissions.push({ eventId: item.event.id, sequence: item.event.sequence, reason: "budget", originalTextBytes: item.originalBytes });
      continue;
    }
    selected.set(item.event.id, prepared);
    serializedBytes += eventBytes;
    remainingTextBytes -= keptBytes;
    if (item.redacted) redactedCount += 1;
    if (wasTruncated) omissions.push({ eventId: item.event.id, sequence: item.event.sequence, reason: "oversize", originalTextBytes: item.originalBytes });
  }
  if (!selected.size) throw new MemoryInputError("INPUT_BUDGET_EXCEEDED", "记录的结构化字段超过提炼输入上限");

  const events = snapshot.events.filter((event) => selected.has(event.id)).map((event) => selected.get(event.id)!);
  const publicScope = {
    serverOrigin: snapshot.scope.serverOrigin,
    projectId: snapshot.scope.projectId,
    taskId: snapshot.scope.taskId,
    sessionKey: snapshot.scope.sessionKey,
  };
  const repositoryBlockers = snapshot.repositoryBlockers.map((blocker) => redactSensitiveText(blocker).text);
  const withoutDigest = {
    schemaVersion: 1 as const,
    scope: publicScope,
    snapshotId: snapshot.snapshotId,
    captureDigest: snapshot.captureDigest,
    promptVersion,
    budgetVersion: MEMORY_INPUT_BUDGET_VERSION,
    redactionVersion: MEMORY_REDACTION_VERSION,
    fromSequence: snapshot.fromSequence,
    toSequence: snapshot.toSequence,
    capturedEventIds: events.map((event) => event.id),
    gapEventIds: snapshot.gapEventIds,
    captureCompleteness: snapshot.captureCompleteness,
    captureFailureCount: snapshot.captureFailures.length,
    events,
    omissions: omissions.sort((left, right) => left.sequence - right.sequence),
    redactedCount,
    repositoryKeyHash: snapshot.repositoryKeyHash,
    headSha: snapshot.headSha,
    dirtyExcluded: snapshot.dirtyExcluded,
    repositoryBlockers,
  };
  const { snapshotId: _snapshotId, ...digestInput } = withoutDigest;
  const inputDigest = sha256(stableStringify(digestInput));
  const prepared = { ...withoutDigest, inputDigest };
  if (Buffer.byteLength(stableStringify(prepared)) > MAX_SERIALIZED_INPUT_BYTES) {
    throw new MemoryInputError("INPUT_BUDGET_EXCEEDED", "提炼元数据超过 2 MiB 上限；请缩小会话范围");
  }
  return prepared;
}

export function createExtractionPreview(input: PreparedExtractionInputV1): ExtractionPreview {
  return {
    destination: input.scope.serverOrigin,
    eventCount: input.events.length,
    sequenceRange: { from: input.fromSequence, to: input.toSequence },
    outboundBytes: Buffer.byteLength(stableStringify(input)),
    redactedCount: input.redactedCount,
    omittedEventCount: input.omissions.length,
    captureGaps: input.gapEventIds.length + input.captureFailureCount,
    completeness: input.captureCompleteness,
    statement: "确认后只会发送脱敏、限额后的整理输入给 AgileCampus 服务端 AI；本机原始记录不会随请求发送。",
  };
}

function preparedBase(event: NormalizedEventV1, command?: string, toolCallId?: string, paths?: string[]): Omit<PreparedEventV1, "text" | "wasTruncated" | "originalTextBytes"> {
  return {
    id: event.id,
    sequence: event.sequence,
    kind: event.kind,
    ...(toolCallId !== undefined ? { toolCallId } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
    ...(paths !== undefined ? { paths: [...paths] } : {}),
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let output = "";
  let used = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (used + size > maxBytes) break;
    output += char;
    used += size;
  }
  return output;
}
