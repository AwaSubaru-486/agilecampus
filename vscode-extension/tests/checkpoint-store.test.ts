import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckpointStore, CheckpointStoreError } from "../src/checkpoints/store";
import { parseWorkCheckpoint } from "../src/checkpoints/schema";
import type { WorkCheckpoint } from "../src/checkpoints/types";

const roots: string[] = [];
const origin = "http://localhost:3000/";
const projectId = "project-a";
const taskId = "task-a";
const checkpointId = "d87c4e10-09d1-40d6-9e55-62bc029940b9";

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function manifest(overrides: Partial<WorkCheckpoint> = {}): WorkCheckpoint {
  return {
    schemaVersion: 1,
    id: checkpointId,
    parentCheckpointId: null,
    serverOrigin: origin,
    projectId,
    taskId,
    milestoneId: null,
    capturedAt: "2026-10-01T06:00:00.000Z",
    handoffVersion: 2,
    taskUpdatedAt: "2026-10-01T05:00:00.000Z",
    taskSnapshot: {
      title: "交接测试", status: "in_progress", priority: "medium", dueDate: null, assigneeId: null, assigneeName: null,
      description: null, handoffBrief: "完成验证", doneCriteria: ["有可查结果"], requiredEvidence: [],
      responseDueAt: null, completionNote: null, committedHandoffVersion: 2,
    },
    repository: {
      key: "local:install-identity",
      headSha: "a".repeat(40),
      branch: "main",
      dirty: true,
      dirtyPolicy: "excluded",
      recoveryBlockers: [],
    },
    session: { provider: "Entire CLI", providerVersion: "0.11.3", sessionId: null, checkpointId: null, captureMode: "context-only" },
    handoff: { goal: "验证交接", completed: [], remaining: ["验证恢复"], blocker: null, rejectedApproaches: [], nextAction: "先检查 SHA" },
    tests: [],
    artifacts: [],
    ...overrides,
  };
}

describe("local checkpoint store", () => {
  it("atomically persists an immutable manifest and verifies artifact hashes after reopening", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-checkpoint-"));
    roots.push(root);
    const store = new CheckpointStore(root);
    const saved = await store.save(manifest(), [{ kind: "transcript", content: Buffer.from("private transcript") }]);
    const reopened = new CheckpointStore(root);
    await expect(reopened.read(origin, projectId, checkpointId)).resolves.toEqual(saved);
    await expect(reopened.list(origin, projectId)).resolves.toMatchObject([{ manifest: saved, integrity: "verified" }]);
    await expect(reopened.list(origin, "another-project")).resolves.toEqual([]);
  });

  it("refuses to replace an existing checkpoint ID", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-checkpoint-"));
    roots.push(root);
    const store = new CheckpointStore(root);
    await store.save(manifest(), []);
    await expect(store.save(manifest({ handoff: { ...manifest().handoff, goal: "overwrite attempt" } }), []))
      .rejects.toBeInstanceOf(CheckpointStoreError);
    await expect(store.read(origin, projectId, checkpointId)).resolves.toMatchObject({ handoff: { goal: "验证交接" } });
  });

  it("rejects modified artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-checkpoint-"));
    roots.push(root);
    const store = new CheckpointStore(root);
    const saved = await store.save(manifest(), [{ kind: "context", content: Buffer.from("original") }]);
    const artifactPath = path.join(root, "checkpoints", hash(origin), hash(projectId), checkpointId, saved.artifacts[0].relativePath);
    await writeFile(artifactPath, "changed");
    await expect(store.read(origin, projectId, checkpointId)).rejects.toThrow("完整性校验失败");
  });

  it("rejects symlinked artifacts rather than reading outside the checkpoint directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-checkpoint-"));
    roots.push(root);
    const store = new CheckpointStore(root);
    const saved = await store.save(manifest(), [{ kind: "context", content: Buffer.from("expected") }]);
    const artifactPath = path.join(root, "checkpoints", hash(origin), hash(projectId), checkpointId, saved.artifacts[0].relativePath);
    const outsidePath = path.join(root, "outside-secret.txt");
    await writeFile(outsidePath, "must not be followed");
    await unlink(artifactPath);
    await symlink(outsidePath, artifactPath);
    await expect(store.read(origin, projectId, checkpointId)).rejects.toThrow("不是普通文件");
  });

  it("rejects unsafe relative artifact paths during runtime schema parsing", () => {
    const invalid = {
      ...manifest(),
      artifacts: [{ id: "f011f4b5-f083-4865-97b6-b07935a8aa12", kind: "transcript", relativePath: "../../secret", byteLength: 1, sha256: "b".repeat(64) }],
    };
    expect(() => parseWorkCheckpoint(invalid)).toThrow("附件路径无效");
  });

  it("reads earlier schemaVersion 1 task snapshots without a due date field", () => {
    const { dueDate: _legacyField, ...legacyTask } = manifest().taskSnapshot;
    expect(parseWorkCheckpoint({ ...manifest(), taskSnapshot: legacyTask }).taskSnapshot.dueDate).toBeNull();
  });

  it("stores no transcript text in the manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-checkpoint-"));
    roots.push(root);
    const store = new CheckpointStore(root);
    await store.save(manifest(), [{ kind: "transcript", content: Buffer.from("SECRET_CONVERSATION") }]);
    const file = path.join(root, "checkpoints", hash(origin), hash(projectId), checkpointId, "manifest.json");
    await expect(readFile(file, "utf8")).resolves.not.toContain("SECRET_CONVERSATION");
  });
});

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
