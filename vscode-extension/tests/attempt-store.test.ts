import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "launching",
      workdir: "/tmp/worktree", pid: null, exitCode: null, timedOut: false,
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
      mode: "context-only", provider: "codex-cli", providerSessionId: "00000000-0000-4000-8000-000000000001", state: "running",
      workdir: "/tmp/worktree", pid: 1234, exitCode: null, timedOut: false,
    });
    await store.markInterruptedUnknown();
    expect(await store.read(attempt.id)).toMatchObject({ state: "unknown", pid: 1234 });
    await expect(store.hasPotentiallyActiveAttempt(attempt.checkpointId)).resolves.toBe(true);
    await store.update(attempt.id, { state: "finished", exitCode: 0 });
    await expect(store.hasPotentiallyActiveAttempt(attempt.checkpointId)).resolves.toBe(false);
  });
});
