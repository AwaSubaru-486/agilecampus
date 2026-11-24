import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSessionMemoryPackageV1,
  computeSessionMemoryReviewDigest,
  parseMemoryDocumentV1,
  parseNormalizedEventV1,
  parseSessionMemoryPackageV1,
  SESSION_MEMORY_MAX_SEGMENT_BYTES,
} from "../shared/session-memory";
import type { SourceArchiveBuildInput } from "../shared/session-memory";
import { parseSessionMemoryPackage } from "../vscode-extension/src/checkpoints/session-memory-package";
import type { MemoryDocumentV1, NormalizedEventV1 } from "../shared/session-memory";

const ids = {
  session: "00000000-0000-4000-8000-000000000001",
  package: "00000000-0000-4000-8000-000000000002",
  memory: "00000000-0000-4000-8000-000000000003",
  checkpoint: "00000000-0000-4000-8000-000000000004",
  user: "00000000-0000-4000-8000-000000000005",
  assistant: "00000000-0000-4000-8000-000000000006",
  call: "00000000-0000-4000-8000-000000000007",
  result: "00000000-0000-4000-8000-000000000008",
  git: "00000000-0000-4000-8000-000000000009",
  gap: "00000000-0000-4000-8000-000000000010",
  item: "00000000-0000-4000-8000-000000000011",
  parentPackage: "00000000-0000-4000-8000-000000000012",
  parentMemory: "00000000-0000-4000-8000-000000000013",
};
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const events: NormalizedEventV1[] = [
  { schemaVersion: 1, id: ids.user, sessionKey: ids.session, sequence: 1, timestamp: "2026-10-02T01:00:00.000Z", kind: "user", text: "Please fix the test.", sourceRef: "events/source#1" },
  { schemaVersion: 1, id: ids.assistant, sessionKey: ids.session, sequence: 2, timestamp: null, kind: "assistant", text: "I will inspect it.", sourceRef: "events/source#2" },
  { schemaVersion: 1, id: ids.call, sessionKey: ids.session, sequence: 3, timestamp: null, kind: "tool_call", toolCallId: "tool-1", command: "npm test", text: "", sourceRef: "events/source#3" },
  { schemaVersion: 1, id: ids.result, sessionKey: ids.session, sequence: 4, timestamp: null, kind: "tool_result", toolCallId: "tool-1", exitCode: 0, text: "passed", sourceRef: "events/source#4" },
  { schemaVersion: 1, id: ids.git, sessionKey: ids.session, sequence: 5, timestamp: null, kind: "git_snapshot", paths: ["src/file.ts"], text: "HEAD abc", sourceRef: "events/source#5" },
  { schemaVersion: 1, id: ids.gap, sessionKey: ids.session, sequence: 6, timestamp: null, kind: "gap", text: "provider omitted an event", sourceRef: "events/source#6" },
];

function memory(): MemoryDocumentV1 {
  return {
    schemaVersion: 1, id: ids.memory, sessionKey: ids.session, projectId: "project-a", taskId: "task-a", parentMemoryId: null, revision: 1,
    inputDigest: "a".repeat(64), sourceCoverage: { fromSequence: 1, toSequence: 6, gaps: [ids.gap] },
    code: { repositoryKeyHash: "b".repeat(64), headSha: "c".repeat(40), dirtyExcluded: true },
    goal: [{ id: ids.item, text: "Fix the test", evidenceRefs: [ids.user], origin: "extracted", support: "captured", disposition: "active" }],
    constraints: [], completed: [], remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [],
    tests: [{ command: "npm test", exitCode: 0, evidenceRefs: [ids.result], support: "captured" }],
    provenance: { extractor: "fixture", promptVersion: "v1", model: "fixture-model", createdAt: "2026-10-02T01:05:00.000Z", editedBy: null, usage: { inputTokens: 20, outputTokens: 10 } },
  };
}

function sourceArchiveInput(): SourceArchiveBuildInput {
  const source = Buffer.from("user:fix\nassistant:inspect\ncall:test\nresult:verysecret\n", "utf8");
  const published = Buffer.from(source.toString("utf8").replace("verysecret", "[REDACTED]"), "utf8");
  const byteIndex = (bytes: Buffer, text: string) => bytes.indexOf(Buffer.from(text, "utf8"));
  const lineRange = (eventId: string, archiveRecordId: string, sourceText: string, publishedText: string) => {
    const sourceStartByte = byteIndex(source, sourceText);
    const publishedStartByte = byteIndex(published, publishedText);
    return { eventId, archiveRecordId, sourceStartByte, sourceEndByte: sourceStartByte + Buffer.byteLength(sourceText),
      publishedStartByte, publishedEndByte: publishedStartByte + Buffer.byteLength(publishedText) };
  };
  const secretStart = byteIndex(source, "verysecret");
  const publishedSecretStart = byteIndex(published, "[REDACTED]");
  return {
      schemaVersion: 1, status: "complete", provider: "Codex CLI", providerVersion: "0.153.4", adapter: "HookArchive", adapterVersion: "1.0.0",
      parserVersion: "opaque-text-v1", encoding: "utf-8", compression: "none", integrityStatus: "verified",
      sourceByteLength: source.byteLength,
      reachedEof: true, truncationDetected: false, formatRecognized: true, gaps: [],
      redaction: { confirmed: true, confirmedAt: "2026-10-02T01:06:00.000Z", previewDigest: null,
        redactedRanges: [{ sourceStartByte: secretStart, sourceEndByte: secretStart + Buffer.byteLength("verysecret"), publishedStartByte: publishedSecretStart, publishedEndByte: publishedSecretStart + Buffer.byteLength("[REDACTED]"), category: "credential" }],
        excludedRanges: [], redactedByteCount: 10, excludedByteCount: 0 },
      segments: [{ relativePath: "source/000001.txt", sourceStartByte: 0, sourceEndByte: source.byteLength, content: published }],
      eventRanges: [
        lineRange(ids.user, "00000000-0000-4000-8000-000000000021", "user:fix\n", "user:fix\n"),
        lineRange(ids.assistant, "00000000-0000-4000-8000-000000000022", "assistant:inspect\n", "assistant:inspect\n"),
        lineRange(ids.call, "00000000-0000-4000-8000-000000000023", "call:test\n", "call:test\n"),
        lineRange(ids.result, "00000000-0000-4000-8000-000000000024", "result:verysecret\n", "result:[REDACTED]\n"),
      ],
      unmappedEvents: [],
    };
}

function packageValue() {
  return createSessionMemoryPackageV1({
    manifest: { schemaVersion: 1, packageId: ids.package, sessionKey: ids.session, memoryId: ids.memory, checkpointLocalId: ids.checkpoint,
      projectId: "project-a", taskId: "task-a", parentPackageId: null, codeHeadSha: "c".repeat(40), taskHandoffVersion: 2, taskUpdatedAt: "2026-10-02T01:00:00.000Z" },
    memory: memory(), events,
    gaps: [ids.gap],
    publicationCompleteness: "complete",
    sharingReview: { confirmed: true, confirmedAt: "2026-10-02T01:06:00.000Z" },
    sourceArchive: sourceArchiveInput(),
  }, hash);
}

describe("shared session memory contract", () => {
  it("accepts normalized synthetic Codex and Claude Hook payloads without inventing missing evidence", () => {
    const codexPrompt = { session_id: "local-session-codex", cwd: "/private/worktree", prompt: "Fix the regression" };
    const codexTool = { session_id: codexPrompt.session_id, tool_name: "exec_command", tool_input: { command: "npm test" }, tool_output: { exit_code: 0, text: "passed" } };
    const codexStop = { session_id: codexPrompt.session_id, last_assistant_message: "The test passed." };
    const claudeBoundary = { session_id: "local-session-claude", transcript_path: "/private/.claude/transcript.jsonl", hook_event_name: "SessionEnd" };
    const claudePrompt = { session_id: claudeBoundary.session_id, cwd: "/private/claude-worktree", prompt: "Review the fix" };
    const claudeTool = { session_id: claudeBoundary.session_id, tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: "passed" };
    const claudeStop = { session_id: claudeBoundary.session_id, last_assistant_message: "The review is complete." };
    const normalized: NormalizedEventV1[] = [
      { ...events[0], id: ids.user, sessionKey: ids.session, text: codexPrompt.prompt, sourceRef: "hook:codex:user-prompt-submit:1" },
      { ...events[2], id: ids.call, sessionKey: ids.session, toolCallId: "codex-event-2", command: codexTool.tool_input.command, sourceRef: "hook:codex:post-tool-use:2" },
      { ...events[3], id: ids.result, sessionKey: ids.session, toolCallId: "codex-event-2", exitCode: codexTool.tool_output.exit_code, text: codexTool.tool_output.text, sourceRef: "hook:codex:post-tool-use:2:result" },
      { ...events[1], id: ids.assistant, sessionKey: ids.session, text: codexStop.last_assistant_message, sourceRef: "hook:codex:stop:3" },
      { ...events[0], id: "00000000-0000-4000-8000-000000000014", sessionKey: ids.session, sequence: 7, text: claudePrompt.prompt, sourceRef: "hook:claude:UserPromptSubmit:1" },
      { ...events[2], id: "00000000-0000-4000-8000-000000000015", sessionKey: ids.session, sequence: 8, toolCallId: "claude-event-2", command: claudeTool.tool_input.command, sourceRef: "hook:claude:PostToolUse:2" },
      { ...events[3], id: "00000000-0000-4000-8000-000000000016", sessionKey: ids.session, sequence: 9, toolCallId: "claude-event-2", exitCode: null, text: claudeTool.tool_response, sourceRef: "hook:claude:PostToolUse:2:result" },
      { ...events[1], id: "00000000-0000-4000-8000-000000000017", sessionKey: ids.session, sequence: 10, text: claudeStop.last_assistant_message, sourceRef: "hook:claude:Stop:3" },
      { ...events[5], id: ids.gap, sessionKey: ids.session, sequence: 11, text: `${claudeBoundary.hook_event_name}: capture boundary; no transcript body attached`, sourceRef: "hook:claude:SessionEnd:1" },
    ];
    expect(normalized.map(parseNormalizedEventV1).map((event) => event.kind)).toEqual(["user", "tool_call", "tool_result", "assistant", "user", "tool_call", "tool_result", "assistant", "gap"]);
    expect(normalized[1].sessionKey).toBe(normalized[2].sessionKey);
    expect(normalized[8].timestamp).toBeNull();
    expect(JSON.stringify(normalized)).not.toContain(codexPrompt.cwd);
    expect(JSON.stringify(normalized)).not.toContain(claudePrompt.cwd);
    expect(JSON.stringify(normalized)).not.toContain(claudeBoundary.transcript_path);
  });

  it("accepts each normalized event kind and round trips the full package through the extension adapter", () => {
    for (const event of events) expect(parseNormalizedEventV1(event)).toEqual(event);
    const pack = packageValue();
    const decoded = parseSessionMemoryPackage(JSON.parse(JSON.stringify(pack)));
    expect(decoded).toEqual(pack);
    expect(decoded.manifest.segments.every((segment) => segment.byteLength <= SESSION_MEMORY_MAX_SEGMENT_BYTES)).toBe(true);
    expect(decoded.memory.tests[0]).toMatchObject({ exitCode: 0, support: "captured" });
    expect(decoded.sourceArchive).toMatchObject({ status: "complete", integrityStatus: "verified", parserVersion: "opaque-text-v1" });
    expect(Buffer.from(decoded.archiveSegments[0].data, "base64").toString("utf8")).toContain("result:[REDACTED]");
    expect(decoded.sourceArchive.eventRanges.map((item) => item.eventId)).toEqual([ids.user, ids.assistant, ids.call, ids.result]);
    expect(decoded.sourceArchive.eventRanges.every((item) => item.archiveRecordId.length > 0)).toBe(true);
    expect(decoded.sourceArchive).not.toHaveProperty("sourceDigest");
  });

  it("rejects unknown versions, event kinds, memory support, and malformed event fields", () => {
    expect(() => parseNormalizedEventV1({ ...events[0], schemaVersion: 2 })).toThrow("版本");
    expect(() => parseNormalizedEventV1({ ...events[0], kind: "notice" })).toThrow("事件类型");
    expect(() => parseNormalizedEventV1({ ...events[2], toolCallId: undefined })).toThrow("toolCallId");
    expect(() => parseNormalizedEventV1({ ...events[4], paths: ["../secret"] })).toThrow("路径");
    expect(() => parseMemoryDocumentV1({ ...memory(), goal: [{ ...memory().goal[0], support: "verified" }] })).toThrow("support");
  });

  it("rejects fake hashes, unknown evidence references, mismatched task data, and uncaptured tests without evidence", () => {
    const pack = packageValue();
    const fakeHash = structuredClone(pack);
    fakeHash.manifest.segments[0].sha256 = "0".repeat(64);
    expect(() => parseSessionMemoryPackageV1(fakeHash, hash)).toThrow("SHA-256");

    const unknownRef = structuredClone(pack);
    unknownRef.memory.goal[0].evidenceRefs = [ids.checkpoint];
    expect(() => parseSessionMemoryPackage(unknownRef)).toThrow("引用不存在");

    const crossTask = structuredClone(pack);
    crossTask.memory.taskId = "task-other";
    expect(() => parseSessionMemoryPackage(crossTask)).toThrow("范围不一致");

    const mismatchedHead = structuredClone(pack);
    mismatchedHead.memory.code.headSha = "d".repeat(40);
    expect(() => parseSessionMemoryPackage(mismatchedHead)).toThrow("范围不一致");

    expect(() => parseMemoryDocumentV1({ ...memory(), tests: [{ command: "npm test", exitCode: 0, evidenceRefs: [], support: "captured" }] }, new Set(events.map((event) => event.id)))).toThrow("captured 测试");
    expect(() => createSessionMemoryPackageV1({ manifest: packageValue().manifest, memory: memory(), events: events.filter((event) => event.sequence !== 5), gaps: [ids.gap], publicationCompleteness: "complete", sharingReview: { confirmed: true, confirmedAt: "2026-10-02T01:06:00.000Z" }, sourceArchive: sourceArchiveInput() }, hash)).toThrow("覆盖缺口");
  });

  it("validates parent lineage against resolved project, task, and memory revision", () => {
    const pack = structuredClone(packageValue());
    pack.manifest.parentPackageId = ids.parentPackage;
    pack.memory.parentMemoryId = ids.parentMemory;
    pack.memory.revision = 2;
    pack.sharingReview.previewDigest = computeSessionMemoryReviewDigest(pack, hash);
    expect(() => parseSessionMemoryPackage(pack)).toThrow("父包缺失");
    expect(() => parseSessionMemoryPackage(pack, { parent: { packageId: ids.parentPackage, memoryId: ids.parentMemory, projectId: "another-project", taskId: "task-a", revision: 1 } })).toThrow("父包");
    expect(() => parseSessionMemoryPackage(pack, { parent: { packageId: ids.parentPackage, memoryId: ids.parentMemory, projectId: "project-a", taskId: "task-a", revision: 2 } })).toThrow("父包");
    expect(parseSessionMemoryPackage(pack, { parent: { packageId: ids.parentPackage, memoryId: ids.parentMemory, projectId: "project-a", taskId: "task-a", revision: 1 } }).memory.revision).toBe(2);
    expect(() => parseSessionMemoryPackage(pack, { parent: { packageId: ids.parentPackage, memoryId: ids.parentMemory, projectId: "project-a", taskId: "task-a", revision: 1 }, ancestors: [{ packageId: ids.package, memoryId: "00000000-0000-4000-8000-000000000020" }] })).toThrow("循环");
  });

  it("rejects missing or corrupt archive shards, unsafe paths, unknown parser versions, unreviewed redaction, truncation, and partial archives published as complete", () => {
    const pack = packageValue();
    const missing = structuredClone(pack);
    missing.archiveSegments = [];
    expect(() => parseSessionMemoryPackage(missing)).toThrow("原文档案分片缺失");

    const wrongHash = structuredClone(pack);
    wrongHash.sourceArchive.segments[0].sha256 = "0".repeat(64);
    expect(() => parseSessionMemoryPackage(wrongHash)).toThrow("SHA-256");

    const unsafePath = structuredClone(pack);
    unsafePath.sourceArchive.segments[0].relativePath = "source/../../private.txt";
    unsafePath.archiveSegments[0].relativePath = "source/../../private.txt";
    expect(() => parseSessionMemoryPackage(unsafePath)).toThrow("分片描述");

    const unsupportedParser = structuredClone(pack);
    (unsupportedParser.sourceArchive as { parserVersion: string }).parserVersion = "vendor-parser-v99";
    expect(() => parseSessionMemoryPackage(unsupportedParser)).toThrow("parserVersion 未知");

    const unconfirmed = structuredClone(pack);
    unconfirmed.sourceArchive.redaction.confirmed = false;
    expect(() => parseSessionMemoryPackage(unconfirmed)).toThrow("脱敏未预览并确认");

    const noUserConsent = structuredClone(pack);
    noUserConsent.sharingReview.confirmed = false;
    expect(() => parseSessionMemoryPackage(noUserConsent)).toThrow("分享内容未经预览");

    const truncated = structuredClone(pack);
    truncated.sourceArchive.segments[0].sourceEndByte = 10;
    expect(() => parseSessionMemoryPackage(truncated)).toThrow("未覆盖来源字节末尾");

    const partialAsComplete = structuredClone(pack);
    partialAsComplete.sourceArchive.status = "partial";
    partialAsComplete.sourceArchive.integrityStatus = "partial";
    partialAsComplete.sourceArchive.truncationDetected = true;
    expect(() => parseSessionMemoryPackage(partialAsComplete)).toThrow("不能标记为完整发布");

    const unmappedEvidence = structuredClone(pack);
    unmappedEvidence.sourceArchive.eventRanges = unmappedEvidence.sourceArchive.eventRanges.filter((item) => item.eventId !== ids.result);
    expect(() => parseSessionMemoryPackage(unmappedEvidence)).toThrow("完整原文档案必须映射全部对话事件");

    const noRecordTarget = structuredClone(pack);
    noRecordTarget.sourceArchive.eventRanges[0].archiveRecordId = "not-a-record-id";
    expect(() => parseSessionMemoryPackage(noRecordTarget)).toThrow("原文事件范围无效");

    const duplicateRecordTarget = structuredClone(pack);
    duplicateRecordTarget.sourceArchive.eventRanges[1].archiveRecordId = duplicateRecordTarget.sourceArchive.eventRanges[0].archiveRecordId;
    expect(() => parseSessionMemoryPackage(duplicateRecordTarget)).toThrow("归档记录 ID 重复");

    const rangeOutsidePublishedBytes = structuredClone(pack);
    rangeOutsidePublishedBytes.sourceArchive.eventRanges[0].publishedEndByte = rangeOutsidePublishedBytes.sourceArchive.publishedByteLength + 1;
    expect(() => parseSessionMemoryPackage(rangeOutsidePublishedBytes)).toThrow("原文事件范围无效");
  });

  it("represents explicitly consented partial and unavailable archives without claiming completeness", () => {
    const partial = structuredClone(packageValue());
    partial.publicationCompleteness = "partial";
    partial.sourceArchive.status = "partial";
    partial.sourceArchive.integrityStatus = "partial";
    partial.sourceArchive.truncationDetected = true;
    partial.sharingReview.previewDigest = computeSessionMemoryReviewDigest(partial, hash);
    expect(parseSessionMemoryPackage(partial).publicationCompleteness).toBe("partial");

    const eventMissingFromTranscript = structuredClone(packageValue());
    eventMissingFromTranscript.publicationCompleteness = "partial";
    eventMissingFromTranscript.sourceArchive.status = "partial";
    eventMissingFromTranscript.sourceArchive.integrityStatus = "partial";
    eventMissingFromTranscript.sourceArchive.eventRanges = eventMissingFromTranscript.sourceArchive.eventRanges.filter((range) => range.eventId !== ids.result);
    eventMissingFromTranscript.sourceArchive.unmappedEvents = [{ eventId: ids.result, reason: "Hook event absent from transcript export" }];
    eventMissingFromTranscript.sharingReview.previewDigest = computeSessionMemoryReviewDigest(eventMissingFromTranscript, hash);
    const partialParsed = parseSessionMemoryPackage(eventMissingFromTranscript);
    expect(partialParsed.sourceArchive.unmappedEvents).toEqual([{ eventId: ids.result, reason: "Hook event absent from transcript export" }]);
    expect(partialParsed.memory.tests[0].evidenceRefs).toContain(ids.result);

    const missingReason = structuredClone(eventMissingFromTranscript);
    missingReason.sourceArchive.unmappedEvents = [];
    missingReason.sourceArchive.truncationDetected = true;
    missingReason.sharingReview.previewDigest = computeSessionMemoryReviewDigest(missingReason, hash);
    expect(() => parseSessionMemoryPackage(missingReason)).toThrow("逐条说明未映射对话事件");

    expect(() => createSessionMemoryPackageV1({
      manifest: packageValue().manifest,
      memory: memory(),
      events,
      gaps: [ids.gap],
      publicationCompleteness: "complete",
      sharingReview: { confirmed: true, confirmedAt: "2026-10-02T01:06:00.000Z" },
      sourceArchive: {
        schemaVersion: 1, status: "unavailable", provider: "Codex CLI", providerVersion: "0.153.4", adapter: "HookArchive", adapterVersion: "1.0.0",
        parserVersion: "opaque-text-v1", encoding: "utf-8", compression: "none", integrityStatus: "unavailable", sourceByteLength: null,
        reachedEof: false, truncationDetected: false, formatRecognized: false, gaps: [],
        redaction: { confirmed: false, confirmedAt: null, previewDigest: null, redactedRanges: [], excludedRanges: [], redactedByteCount: 0, excludedByteCount: 0 },
        segments: [], eventRanges: [], unmappedEvents: [ids.user, ids.assistant, ids.call, ids.result].map((eventId) => ({ eventId, reason: "Transcript export unavailable" })),
      },
    }, hash)).toThrow("不能标记为完整发布");
  });
});
