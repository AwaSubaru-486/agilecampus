import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttemptStore } from "../src/attempts/store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const storeWorker = `
  const fs = require("node:fs");
  const path = require("node:path");
  const Module = require("node:module");
  const ts = require("typescript");
  const sourcePath = path.resolve(process.cwd(), "src/attempts/store.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const compiled = new Module(sourcePath, module);
  compiled.filename = sourcePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  compiled._compile(output, sourcePath);
  const [storage, operation, target, payload] = process.argv.slice(1);
  const store = new compiled.exports.AttemptStore(storage);
  const action = operation === "lease"
    ? store.acquireWorkdirLease(target, payload).then(async (acquired) => {
        process.stdout.write(String(acquired));
        if (acquired) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await store.releaseWorkdirLease(target, payload);
        }
      })
    : store.update(target, JSON.parse(payload)).then(() => process.stdout.write("updated"));
  action.catch((error) => { console.error(error); process.exitCode = 1; });
`;

function runStoreWorker(storage: string, operation: string, target: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", storeWorker, storage, operation, target, payload], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `store worker exited ${code}`)));
  });
}

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

  it("does not reclaim a live lease written by the previous extension version", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-legacy-lock-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    const canonicalWorkdir = await realpath(workdir);
    const leaseId = createHash("sha256").update(canonicalWorkdir).digest("hex");
    const legacyLeasePath = path.join(storage, "attempt-locks", `${leaseId}.lock`);
    await mkdir(legacyLeasePath, { recursive: true });
    await writeFile(path.join(legacyLeasePath, "owner.json"), JSON.stringify({
      attemptId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", workdir: canonicalWorkdir,
      hostPid: process.pid, agentPid: null,
    }));
    await expect(new AttemptStore(storage).acquireWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e"))
      .resolves.toBe(false);
  });

  it("allows only one process to reclaim a stale workdir lease", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-stale-lock-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    const canonicalWorkdir = await realpath(workdir);
    const leaseId = createHash("sha256").update(canonicalWorkdir).digest("hex");
    const staleLeasePath = path.join(storage, "attempt-locks", `${leaseId}.lock`);
    await mkdir(staleLeasePath, { recursive: true });
    const staleDate = new Date(Date.now() - 60_000);
    await utimes(staleLeasePath, staleDate, staleDate);

    const outcomes = await Promise.all([
      runStoreWorker(storage, "lease", workdir, "d87c4e10-09d1-40d6-9e55-62bc029940b9"),
      runStoreWorker(storage, "lease", workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e"),
    ]);
    expect(outcomes.filter((outcome) => outcome === "true")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "false")).toHaveLength(1);
  }, 15_000);

  it("merges concurrent updates across processes without losing completion evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-")); roots.push(root);
    const storeA = new AttemptStore(root);
    const attempt = await storeA.create({
      checkpointId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", projectId: "project-a", taskId: "task-a",
      attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "running",
      workdir: "/tmp/worktree", branch: "main", baseSha: "a".repeat(40), parentAttemptId: null, pid: null, exitCode: null, timedOut: false,
    });
    await Promise.all([
      runStoreWorker(root, "update", attempt.id, JSON.stringify({
        state: "finished", agentSummary: "completed result", completionHeadSha: "b".repeat(40), completionDirty: false,
      })),
      runStoreWorker(root, "update", attempt.id, JSON.stringify({ testEvidence: "npm test: passed" })),
    ]);
    await expect(storeA.read(attempt.id)).resolves.toMatchObject({
      state: "finished", agentSummary: "completed result", completionHeadSha: "b".repeat(40), completionDirty: false,
      testEvidence: "npm test: passed",
    });
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
