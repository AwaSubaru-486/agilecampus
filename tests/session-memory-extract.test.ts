import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { extractSessionMemoryCandidate, preparedExtractionRequestSchema, validateCandidateEvidence } from "@/lib/session-memory/extract";
import { validateMemoryCandidate } from "../vscode-extension/src/memory/candidate-validator";
import { createUser } from "@/lib/user";
import { saveModelConfig } from "@/lib/model-config";
import { resetDb } from "./helpers";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function preparedInput(promptVersion: "memory-extract-v1" | "memory-extract-v2" | "memory-extract-v3" = "memory-extract-v3") {
  const projectId = randomUUID(); const taskId = randomUUID(); const sessionKey = randomUUID();
  const callId = randomUUID(); const resultId = randomUUID();
  const core = {
    schemaVersion: 1 as const,
    scope: { serverOrigin: "http://localhost:3000/", projectId, taskId, sessionKey },
    snapshotId: randomUUID(), captureDigest: sha256("capture"),
    promptVersion, budgetVersion: "memory-input-v1" as const, redactionVersion: "redaction-v2" as const,
    fromSequence: 1, toSequence: 2, capturedEventIds: [callId, resultId], gapEventIds: [],
    captureCompleteness: "unknown" as const, captureFailureCount: 0,
    events: [
      { id: callId, sequence: 1, kind: "tool_call" as const, text: "synthetic call", toolCallId: "tool-1", command: "npm test", wasTruncated: false, originalTextBytes: 14 },
      { id: resultId, sequence: 2, kind: "tool_result" as const, text: "synthetic exit", toolCallId: "tool-1", exitCode: 0, wasTruncated: false, originalTextBytes: 14 },
    ],
    omissions: [], redactedCount: 0, repositoryKeyHash: sha256("repo"), headSha: "a".repeat(40), dirtyExcluded: false, repositoryBlockers: [],
  };
  const { snapshotId: _snapshot, ...digestPayload } = core;
  return { ...core, inputDigest: sha256(stableStringify(digestPayload)) };
}

describe("session memory model boundary", () => {
  it("用户 API 自动用于记忆提炼，模型来源记录真实的个人模型名称", async () => {
    vi.stubEnv("AUTH_SECRET", "memory-model-routing-secret");
    try {
      await resetDb();
      const user = await createUser({ name: "提炼者", email: "extract@api.test", password: "password123" });
      await saveModelConfig(user.id, { baseUrl: "https://extract.test/v1", model: "personal-memory-model", apiKey: "test-memory-key" });
      const candidate = { goal: [], constraints: [], completed: [], remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [], tests: [] };
      let sentModel = ""; let sentUrl = ""; let sentMessages = "";
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)); sentModel = body.model; sentUrl = String(input);
        sentMessages = JSON.stringify(body.messages);
        return new Response(JSON.stringify({ id: "memory-test", object: "chat.completion", created: 1, model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(candidate) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { headers: { "Content-Type": "application/json" } });
      }));
      const result = await extractSessionMemoryCandidate(preparedInput(), { actorId: user.id });
      expect(sentUrl).toBe("https://extract.test/v1/chat/completions");
      expect(sentModel).toBe("personal-memory-model"); expect(result.model).toBe(sentModel);
      expect(sentMessages).toContain("不能证明当前已完成或已重新测试");
      expect(sentMessages).toContain("contextRole=inherited-memory");
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("accepts only a matching, ordered, budget-scoped request", () => {
    expect(preparedExtractionRequestSchema.parse(preparedInput()).events).toHaveLength(2);
    expect(preparedExtractionRequestSchema.parse(preparedInput("memory-extract-v1")).promptVersion).toBe("memory-extract-v1");
    expect(preparedExtractionRequestSchema.parse(preparedInput("memory-extract-v2")).promptVersion).toBe("memory-extract-v2");
    const invalid = preparedInput();
    invalid.events = [invalid.events[1], invalid.events[0]];
    invalid.capturedEventIds = invalid.events.map((event) => event.id);
    const { snapshotId: _snapshot, inputDigest: _oldDigest, ...payload } = invalid;
    invalid.inputDigest = sha256(stableStringify(payload));
    expect(() => preparedExtractionRequestSchema.parse(invalid)).toThrow("事件序号必须递增");
  });

  it("requires candidate evidence to cite supplied events and captured tests to match command, tool and exit code", () => {
    const input = preparedExtractionRequestSchema.parse(preparedInput());
    const valid = {
      goal: [], constraints: [], completed: [], remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [],
      tests: [{ command: "npm test", exitCode: 0, evidenceRefs: [input.events[0].id, input.events[1].id], support: "captured" }],
    };
    expect(validateCandidateEvidence(valid, input).tests).toHaveLength(1);
    expect(() => validateCandidateEvidence({ ...valid, tests: [{ ...valid.tests[0], command: "npm run test" }] }, input)).toThrow("不能标记为 captured");
    expect(() => validateCandidateEvidence({ ...valid, completed: [{ text: "unsupported", evidenceRefs: [randomUUID()], support: "captured" }] }, input)).toThrow("不存在");
  });

  it("does not combine one command with another command's successful result", () => {
    const input = preparedExtractionRequestSchema.parse(preparedInput());
    const [callA, resultA] = input.events;
    const callB = { ...callA, id: randomUUID(), sequence: 3, toolCallId: "tool-2", command: "npm run lint" };
    const resultB = { ...resultA, id: randomUUID(), sequence: 4, toolCallId: "tool-2", exitCode: 0 };
    const failedA = { ...resultA, exitCode: 1 };
    const events = [callA, failedA, callB, resultB];
    const mixedInput = { ...input, toSequence: 4, events, capturedEventIds: events.map((event) => event.id) };
    const candidate = {
      goal: [], constraints: [], completed: [], remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [],
      tests: [{ command: "npm test", exitCode: 0, evidenceRefs: events.map((event) => event.id), support: "captured" as const }],
    };
    expect(() => validateCandidateEvidence(candidate, mixedInput)).toThrow("不能标记为 captured");
    expect(() => validateMemoryCandidate({ ...candidate, model: "synthetic-model", inputTokens: 1, outputTokens: 1 }, mixedInput))
      .toThrow("不能标记为 captured");
  });

  it("rejects tool events with a missing correlation ID", () => {
    const input = preparedInput();
    input.events[0] = { ...input.events[0], toolCallId: "" };
    expect(() => preparedExtractionRequestSchema.parse(input)).toThrow("工具事件必须有非空的调用 ID");
  });

  it("does not upgrade inherited summaries to captured facts on either side of the API", () => {
    const input = preparedExtractionRequestSchema.parse(preparedInput());
    const inherited = { id: randomUUID(), sequence: 3, kind: "user" as const, text: "historical completed work", contextRole: "inherited-memory" as const, wasTruncated: false, originalTextBytes: 25 };
    input.events.push(inherited); input.capturedEventIds.push(inherited.id); input.toSequence = 3;
    const candidate = { goal: [], constraints: [], completed: [{ text: "work completed", evidenceRefs: [inherited.id], support: "captured" }], remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [], tests: [] };
    expect(() => validateCandidateEvidence(candidate, input)).toThrow("仅引用继承摘要");
    expect(() => validateMemoryCandidate({ ...candidate, model: "test", inputTokens: 1, outputTokens: 1 }, input)).toThrow("仅引用继承摘要");
    candidate.completed[0].support = "reported";
    expect(validateCandidateEvidence(candidate, input).completed).toHaveLength(1);
    expect(() => preparedExtractionRequestSchema.parse({ ...input, promptVersion: "memory-extract-v2" })).toThrow("只适用于 v3");
  });
});
