import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttemptStore } from "../src/attempts/store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("local attempt receipts", () => {
  it("persists state without prompt or transcript content and serializes updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-")); roots.push(root);
    const store = new AttemptStore(root);
    const attempt = await store.create({
      checkpointId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", projectId: "project-a", taskId: "task-a",
      attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "launching",
      workdir: "/tmp/worktree", branch: "main", baseSha: "a".repeat(40), parentAttemptId: null, pid: null, exitCode: null, timedOut: false,
    });
    await Promise.all([
      store.update(attempt.id, { providerSessionId: "00000000-0000-4000-8000-000000000001", state: "running" }),
      store.update(attempt.id, { pid: 1234 }),
    ]);
    expect(await store.read(attempt.id)).toMatchObject({ state: "running", providerSessionId: "00000000-0000-4000-8000-000000000001", pid: 1234 });
    expect(await readFile(path.join(root, "attempts", `${attempt.id}.json`), "utf8")).not.toContain("transcript");
  });

  it("marks process state as unknown after extension restart and blocks duplicate attempts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-")); roots.push(root);
    const store = new AttemptStore(root);
    const attempt = await store.create({
      checkpointId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", projectId: "project-a", taskId: "task-a",
      attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId: "00000000-0000-4000-8000-000000000001", state: "running",
      workdir: "/tmp/worktree", branch: "main", baseSha: "a".repeat(40), parentAttemptId: null, pid: 1234, exitCode: null, timedOut: false,
    });
    await store.markInterruptedUnknown();
    expect(await store.read(attempt.id)).toMatchObject({ state: "unknown", pid: 1234 });
    await expect(store.hasPotentiallyActiveAttempt(attempt.checkpointId)).resolves.toBe(true);
    await store.update(attempt.id, { state: "finished", exitCode: 0 });
    await expect(store.hasPotentiallyActiveAttempt(attempt.checkpointId)).resolves.toBe(false);
  });

  it("shares a workdir lease across AttemptStore instances and keeps live processes running", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-")); roots.push(root);
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    const storeA = new AttemptStore(path.join(root, "global"));
    const storeB = new AttemptStore(path.join(root, "global"));
    const firstId = "d87c4e10-09d1-40d6-9e55-62bc029940b9";
    const secondId = "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e";

    const [firstAcquired, secondAcquired] = await Promise.all([
      storeA.acquireWorkdirLease(workdir, firstId),
      storeB.acquireWorkdirLease(path.resolve(workdir), secondId),
    ]);
    expect([firstAcquired, secondAcquired].filter(Boolean)).toHaveLength(1);
    const owner = firstAcquired ? storeA : storeB;
    const next = firstAcquired ? storeB : storeA;
    const ownerId = firstAcquired ? firstId : secondId;
    const nextId = firstAcquired ? secondId : firstId;
    await owner.releaseWorkdirLease(workdir, ownerId);
    await expect(next.acquireWorkdirLease(workdir, nextId)).resolves.toBe(true);
    await next.releaseWorkdirLease(workdir, nextId);

    const live = await storeA.create({
      checkpointId: "00000000-0000-4000-8000-000000000001", projectId: "project-a", taskId: "task-a",
      attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "running",
      workdir, branch: "main", baseSha: "a".repeat(40), parentAttemptId: null, pid: process.pid, exitCode: null, timedOut: false,
    });
    await storeB.markInterruptedUnknown();
    await expect(storeB.read(live.id)).resolves.toMatchObject({ state: "running" });
  });

  it("keeps pre-E08 E07 attempt records readable without branch metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-")); roots.push(root);
    const store = new AttemptStore(root);
    const id = "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e";
    await mkdir(path.join(root, "attempts"), { recursive: true });
    await writeFile(path.join(root, "attempts", `${id}.json`), JSON.stringify({
      id, checkpointId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", projectId: "project-a", taskId: "task-a",
      mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "finished",
      startedAt: "2026-10-01T06:00:00.000Z", updatedAt: "2026-10-01T06:01:00.000Z",
      workdir: "/tmp/worktree", pid: 1234, exitCode: 0, timedOut: false,
    }));
    await expect(store.read(id)).resolves.toMatchObject({ attemptKind: "single", baseSha: null, branch: null, state: "finished" });
  });

  it("allows multiple prepared parallel attempts from one checkpoint without treating them as active processes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-")); roots.push(root);
    const store = new AttemptStore(root);
    for (const id of ["d87c4e10-09d1-40d6-9e55-62bc029940b9", "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e"]) {
      await store.create({
        checkpointId: "00000000-0000-4000-8000-000000000001", projectId: "project-a", taskId: "task-a",
        attemptKind: "parallel", mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "prepared",
        workdir: `/tmp/${id}`, branch: `agilecampus/attempt-${id.replace(/-/g, "").slice(0, 8)}`,
        baseSha: "a".repeat(40), parentAttemptId: null, pid: null, exitCode: null, timedOut: false,
      }, id);
    }
    await expect(store.hasPotentiallyActiveAttempt("00000000-0000-4000-8000-000000000001", "parallel")).resolves.toBe(false);
  });
});
