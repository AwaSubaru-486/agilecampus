import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createExtractionPreview, prepareExtractionInput } from "../src/memory/input-builder";
import type { ExtractionSnapshotV1 } from "../src/memory/types";
import { computeCaptureDigest, sha256, stableStringify } from "../src/memory/input-snapshot";

function snapshot(events: ExtractionSnapshotV1["events"], repositoryBlockers: string[] = []): ExtractionSnapshotV1 {
  const sessionKey = events[0]?.sessionKey ?? randomUUID();
  const gaps = events.filter((item) => item.kind === "gap").map((item) => item.id);
  const base = {
    schemaVersion: 1, snapshotId: randomUUID(),
    scope: {
      serverOrigin: "http://localhost:3000/", actorScope: "a".repeat(64), workspaceScope: "b".repeat(64),
      projectId: randomUUID(), taskId: randomUUID(), sessionKey,
    },
    createdAt: "2026-10-05T12:00:00.000Z", fromSequence: events[0]?.sequence ?? 1,
    toSequence: events[events.length - 1]?.sequence ?? 1,
    orderedEventIds: events.map((event) => event.id), events,
    perEventHashes: events.map((item) => sha256(stableStringify(item))), captureFailures: [], gapEventIds: gaps,
    captureCompleteness: gaps.length ? "partial" as const : "unknown" as const, repositoryKeyHash: "d".repeat(64), headSha: "e".repeat(40),
    branch: "main", dirtyExcluded: false, repositoryBlockers,
    contentBytes: events.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item)), 0),
  };
  return { ...base, captureDigest: computeCaptureDigest(base) };
}

function event(sessionKey: string, sequence: number, text: string) {
  return {
    schemaVersion: 1 as const, id: randomUUID(), sessionKey, sequence,
    timestamp: "2026-10-05T12:00:00.000Z", kind: "assistant" as const, text, sourceRef: `synthetic:${sequence}`,
  };
}

describe("memory extraction input", () => {
  it("redacts likely credentials from text and commands without changing the source snapshot", () => {
    const source = event(randomUUID(), 1, "synthetic API_KEY=never-share-this-secret-123456 and sk-abcdefghijklmnopqrstuvwxyz123456");
    const sourceSnapshot = snapshot([source]);
    const prepared = prepareExtractionInput(sourceSnapshot);
    expect(JSON.stringify(prepared)).not.toContain("never-share-this-secret");
    expect(JSON.stringify(prepared)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(prepared.redactedCount).toBe(1);
    expect(source.text).toContain("never-share-this-secret");
  });

  it("removes local absolute paths from session text and tool commands while keeping remote URLs", () => {
    const sessionKey = randomUUID();
    const source = event(sessionKey, 1, "synthetic read /Users/synthetic-user/campus/src/main.ts and file:///private/tmp/campus/state.json https://docs.example.test/guide");
    const call = {
      ...event(sessionKey, 2, "synthetic test command"), kind: "tool_call" as const,
      toolCallId: "tool-1", command: String.raw`node C:\Users\synthetic-user\campus\test.mjs`,
    };
    const prepared = prepareExtractionInput(snapshot([source, call], ["synthetic blocked at /Users/synthetic-user/campus/.git"]));
    const serialized = JSON.stringify(prepared);
    expect(serialized).not.toContain("/Users/synthetic-user");
    expect(serialized).not.toContain("/private/tmp/campus");
    expect(serialized).not.toContain("C:\\Users\\synthetic-user");
    expect(serialized).not.toContain("/Users/synthetic-user");
    expect(prepared.repositoryBlockers[0]).toContain("[REDACTED:LOCAL_PATH]");
    expect(serialized).toContain("https://docs.example.test/guide");
    expect(prepared.redactedCount).toBe(2);
  });

  it("does not expose secrets hidden in tool metadata and replaces provider tool IDs with local aliases", () => {
    const sessionKey = randomUUID();
    const sourceCall = {
      ...event(sessionKey, 1, "synthetic tool call"), kind: "tool_call" as const,
      toolCallId: "sk-abcdefghijklmnopqrstuvwxyz123456", command: "npm test --token=not-a-real-secret-123456",
      paths: ["src/api_key=not-a-real-secret-123456"],
    };
    const sourceResult = {
      ...event(sessionKey, 2, "synthetic tool result"), kind: "tool_result" as const,
      toolCallId: sourceCall.toolCallId, exitCode: 0,
    };
    const prepared = prepareExtractionInput(snapshot([sourceCall, sourceResult]));
    const serialized = JSON.stringify(prepared);
    expect(serialized).not.toContain("not-a-real-secret");
    expect(serialized).not.toContain(sourceCall.toolCallId);
    expect(prepared.events.map((item) => item.toolCallId)).toEqual(["tool-1", "tool-1"]);
    expect(prepared.redactedCount).toBeGreaterThan(0);
  });

  it("caps a long event on a UTF-8 boundary and reports the omission", () => {
    const source = event(randomUUID(), 1, "汉🙂".repeat(20_000));
    const prepared = prepareExtractionInput(snapshot([source]));
    expect(Buffer.byteLength(prepared.events[0].text)).toBeLessThanOrEqual(8 * 1024);
    expect(prepared.events[0].wasTruncated).toBe(true);
    expect(prepared.omissions).toEqual([{ eventId: source.id, sequence: 1, reason: "oversize", originalTextBytes: Buffer.byteLength(source.text) }]);
  });

  it("keeps newest events within the text budget and retains exact omission IDs", () => {
    const sessionKey = randomUUID();
    const source = Array.from({ length: 12 }, (_, index) => event(sessionKey, index + 1, `entry-${index + 1}-` + "x".repeat(8 * 1024)));
    const prepared = prepareExtractionInput(snapshot(source));
    expect(Buffer.byteLength(prepared.events.map((item) => item.text).join(""))).toBeLessThanOrEqual(48 * 1024);
    expect(prepared.events[0].sequence).toBeLessThan(prepared.events.at(-1)!.sequence);
    expect(prepared.omissions.length).toBeGreaterThan(0);
    expect(prepared.omissions.every((item) => !prepared.capturedEventIds.includes(item.eventId) || item.reason === "oversize")).toBe(true);
  });

  it("produces a deterministic digest independent of snapshot ID and uses prompt version in the digest", () => {
    const source = event(randomUUID(), 1, "same synthetic event");
    const first = snapshot([source]);
    const second = { ...first, snapshotId: randomUUID(), createdAt: "2026-10-05T13:00:00.000Z" };
    const a = prepareExtractionInput(first);
    const b = prepareExtractionInput(second);
    const changedPolicy = prepareExtractionInput(first, { promptVersion: "memory-extract-v2" });
    expect(a.inputDigest).toBe(b.inputDigest);
    expect(a.inputDigest).not.toBe(changedPolicy.inputDigest);
  });

  it("shows what will leave the extension without claiming the source is complete", () => {
    const source = event(randomUUID(), 1, "synthetic event");
    const gap = { ...event(source.sessionKey, 2, "capture lost a synthetic event"), kind: "gap" as const };
    const prepared = prepareExtractionInput(snapshot([source, gap]));
    const preview = createExtractionPreview(prepared);
    expect(preview.outboundBytes).toBeGreaterThan(0);
    expect(preview.completeness).toBe("partial");
    expect(preview.captureGaps).toBe(1);
    expect(preview.statement).toContain("原始记录不会随请求发送");
  });
});
