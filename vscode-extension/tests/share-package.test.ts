import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckpointStore } from "../src/checkpoints/store";
import { createSharePackage, findObviousSecrets, parseSharePackage } from "../src/checkpoints/share-package";
import type { WorkCheckpoint } from "../src/checkpoints/types";

const sourceId = "d87c4e10-09d1-40d6-9e55-62bc029940b9";
const transcriptId = "f011f4b5-f083-4865-97b6-b07935a8aa12";
const contextId = "a321fd94-526d-4ab8-947f-41e5e978f615";
const origin = "https://agilecampus.example/";
const projectId = "project-a";
const taskId = "task-a";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function sha(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function checkpoint(): WorkCheckpoint {
  const transcript = Buffer.from('{"type":"response_item","payload":{"text":"private"}}\n');
  const context = Buffer.from("{\"summary\":\"approved\"}");
  return {
    schemaVersion: 1, id: sourceId, parentCheckpointId: null, serverOrigin: origin, projectId, taskId,
    milestoneId: null, capturedAt: "2026-10-01T06:00:00.000Z", handoffVersion: 2,
    taskUpdatedAt: "2026-10-01T05:00:00.000Z",
    repository: { key: "remote:opaque", headSha: "a".repeat(40), branch: "main", dirty: false, dirtyPolicy: "clean-only", recoveryBlockers: [] },
    session: { provider: "Entire CLI", providerVersion: "0.11.3", sessionId: "00000000-0000-4000-8000-000000000001", checkpointId: "01H00000000000000000000001", captureMode: "context-only" },
    handoff: { goal: "Continue task", completed: ["captured"], remaining: ["verify"], blocker: null, rejectedApproaches: [], nextAction: "verify the SHA" },
    tests: [],
    artifacts: [
      { id: transcriptId, kind: "transcript", relativePath: `artifacts/${transcriptId}.transcript`, byteLength: transcript.byteLength, sha256: sha(transcript) },
      { id: contextId, kind: "context", relativePath: `artifacts/${contextId}.json`, byteLength: context.byteLength, sha256: sha(context) },
    ],
  };
}

function sourceArtifacts() {
  return [
    { id: transcriptId, kind: "transcript" as const, content: Buffer.from('{"type":"response_item","payload":{"text":"private"}}\n') },
    { id: contextId, kind: "context" as const, content: Buffer.from("{\"summary\":\"approved\"}") },
  ];
}

describe("reviewed checkpoint JSON package", () => {
  it("exports a new child checkpoint with exactly the selected materials and imports it locally", async () => {
    const source = checkpoint();
    const contextOnly = createSharePackage(source, [sourceArtifacts()[1]]);
    expect(contextOnly.value.manifest.id).not.toBe(source.id);
    expect(contextOnly.value.manifest.parentCheckpointId).toBe(source.id);
    expect(contextOnly.value.artifacts).toHaveLength(1);
    expect(contextOnly.value.artifacts[0].kind).toBe("context");
    const parsed = parseSharePackage(contextOnly.bytes);
    const root = await mkdtemp(path.join(tmpdir(), "agile-share-"));
    roots.push(root);
    const imported = await new CheckpointStore(root).save(parsed.value.manifest, parsed.artifacts);
    expect(imported.repository.headSha).toBe(source.repository.headSha);
    expect(imported.handoff).toEqual(source.handoff);
    expect(imported.artifacts).toHaveLength(1);
  });

  it("round trips an explicitly included transcript with matching SHA-256", () => {
    const built = createSharePackage(checkpoint(), sourceArtifacts());
    const parsed = parseSharePackage(built.bytes);
    expect(parsed.artifacts).toHaveLength(2);
    expect(parsed.artifacts.find((item) => item.kind === "transcript")?.content).toEqual(sourceArtifacts()[0].content);
  });

  it("rejects content tampering, path traversal, and duplicate artifact references", () => {
    const built = createSharePackage(checkpoint(), sourceArtifacts());
    const tampered = structuredClone(built.value);
    tampered.artifacts[0].data = Buffer.from("changed").toString("base64");
    expect(() => parseSharePackage(Buffer.from(JSON.stringify(tampered)))).toThrow("附件完整性校验失败");

    const traversal = structuredClone(built.value);
    traversal.manifest.artifacts[0].relativePath = "../../outside";
    traversal.manifestSha256 = sha(Buffer.from(JSON.stringify(traversal.manifest)));
    expect(() => parseSharePackage(Buffer.from(JSON.stringify(traversal)))).toThrow("附件路径无效");

    const duplicate = structuredClone(built.value);
    duplicate.artifacts[1].id = duplicate.artifacts[0].id;
    expect(() => parseSharePackage(Buffer.from(JSON.stringify(duplicate)))).toThrow("重复");
  });

  it("rejects oversized artifacts and packages", () => {
    expect(() => createSharePackage(checkpoint(), [{ id: contextId, kind: "context", content: Buffer.alloc(5 * 1024 * 1024 + 1) }]))
      .toThrow("5 MiB");
    expect(() => parseSharePackage(Buffer.alloc(15 * 1024 * 1024 + 1))).toThrow("15 MiB");
  });

  it("detects obvious credentials but does not claim universal secret detection", () => {
    expect(findObviousSecrets("Authorization: Bearer test-secret-value")).toContain("Bearer token");
    expect(findObviousSecrets("api_key=Abcdefghijklmnop123")).toContain("API key");
    expect(findObviousSecrets("ordinary task context only")).toEqual([]);
  });
});
