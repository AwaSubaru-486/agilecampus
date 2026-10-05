import type { PreparedExtractionInputV1, CandidateItem, CandidateTest, MemoryCandidateV1, PreparedEventV1 } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_FIELDS = ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const;

export class MemoryCandidateError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "MemoryCandidateError"; }
}

export function validateMemoryCandidate(value: unknown, input: PreparedExtractionInputV1): MemoryCandidateV1 {
  if (!isRecord(value)) throw new MemoryCandidateError("INVALID_CANDIDATE", "AI 返回的记忆候选不是对象");
  const events = new Map(input.events.map((event) => [event.id, event]));
  const output: Record<string, unknown> = {};
  for (const category of ITEM_FIELDS) {
    const rawItems = value[category];
    if (!Array.isArray(rawItems) || rawItems.length > 30) throw new MemoryCandidateError("INVALID_CANDIDATE", `记忆候选字段 ${category} 无效`);
    output[category] = rawItems.map((item) => validateItem(item, events));
  }
  if (!Array.isArray(value.tests) || value.tests.length > 30) throw new MemoryCandidateError("INVALID_CANDIDATE", "测试候选无效");
  output.tests = value.tests.map((item) => validateTest(item, events));
  if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 120 ||
      !usage(value.inputTokens) || !usage(value.outputTokens)) {
    throw new MemoryCandidateError("INVALID_CANDIDATE", "提炼来源或用量信息无效");
  }
  output.model = value.model;
  output.inputTokens = value.inputTokens;
  output.outputTokens = value.outputTokens;
  return output as unknown as MemoryCandidateV1;
}

function validateItem(value: unknown, events: Map<string, PreparedEventV1>): CandidateItem {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim() || value.text.length > 2000 ||
      !["captured", "reported", "inferred"].includes(String(value.support)) ||
      !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1 || value.evidenceRefs.length > 10 ||
      !value.evidenceRefs.every((id) => typeof id === "string" && UUID.test(id) && events.has(id))) {
    throw new MemoryCandidateError("INVALID_EVIDENCE", "记忆条目内容或来源引用无效");
  }
  if (new Set(value.evidenceRefs as string[]).size !== value.evidenceRefs.length) throw new MemoryCandidateError("INVALID_CANDIDATE", "记忆条目重复引用来源");
  return { text: value.text.trim(), evidenceRefs: value.evidenceRefs as string[], support: value.support as CandidateItem["support"] };
}

function validateTest(value: unknown, events: Map<string, PreparedEventV1>): CandidateTest {
  if (!isRecord(value) || typeof value.command !== "string" || !value.command.trim() || value.command.length > 1000 ||
      !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) ||
      !["captured", "reported"].includes(String(value.support)) ||
      !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1 || value.evidenceRefs.length > 10 ||
      !value.evidenceRefs.every((id) => typeof id === "string" && UUID.test(id) && events.has(id))) {
    throw new MemoryCandidateError("INVALID_EVIDENCE", "测试记录或来源引用无效");
  }
  const cited = (value.evidenceRefs as string[]).map((id) => events.get(id)!);
  if (value.support === "captured") {
    const calls = cited.filter((event) => event.kind === "tool_call" && event.command === value.command && event.toolCallId?.trim());
    const matchedResult = calls.some((call) => cited.some((event) => event.kind === "tool_result" && event.toolCallId === call.toolCallId &&
      event.exitCode === value.exitCode && event.exitCode !== null));
    if (!calls.length || !matchedResult || value.exitCode === null) {
      throw new MemoryCandidateError("UNSUPPORTED_CAPTURED_TEST", "测试缺少匹配的结构化命令和非空退出码，不能标记为 captured");
    }
  } else if (!cited.some((event) => event.kind === "user" || event.kind === "assistant")) {
    throw new MemoryCandidateError("UNSUPPORTED_REPORTED_TEST", "reported 测试必须引用口头陈述事件");
  }
  return { command: value.command.trim(), exitCode: value.exitCode as number | null, evidenceRefs: value.evidenceRefs as string[], support: value.support as CandidateTest["support"] };
}

function usage(value: unknown): value is number | null { return value === null || Number.isSafeInteger(value) && (value as number) >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
