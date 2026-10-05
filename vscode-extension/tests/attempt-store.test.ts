import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AttemptStore } from "../src/attempts/store";

const roots: string[] = [];
const storeSourcePath = fileURLToPath(new URL("../src/attempts/store.ts", import.meta.url));
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const storeWorker = `
  const fs = require("node:fs");
  const path = require("node:path");
  const ts = require("typescript");
  require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    module._compile(output, filename);
  };
  const [sourcePath, storage, operation, target, payload] = process.argv.slice(1);
  const { AttemptStore } = require(sourcePath);
  const store = new AttemptStore(storage);
  const action = operation === "lease" || operation === "lease-hold"
    ? store.acquireWorkdirLease(target, payload).then(async (acquired) => {
        process.stdout.write(String(acquired));
        if (acquired) {
          if (operation === "lease") {
            await new Promise((resolve) => setTimeout(resolve, 250));
            await store.releaseWorkdirLease(target, payload);
          } else {
            setInterval(() => {}, 1000);
          }
        }
      })
    : store.update(target, JSON.parse(payload)).then(() => process.stdout.write("updated"));
  action.catch((error) => { console.error(error); process.exitCode = 1; });
`;

function runStoreWorker(storage: string, operation: string, target: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", storeWorker, storeSourcePath, storage, operation, target, payload], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `store worker exited ${code}`)));
  });
}

function spawnStoreWorker(storage: string, operation: string, target: string, payload: string) {
  return spawn(process.execPath, ["-e", storeWorker, storeSourcePath, storage, operation, target, payload], { cwd: process.cwd() });
}

async function getExitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  if (!child.pid) throw new Error("could not start short-lived test process");
  const pid = child.pid;
  await waitForWorkerClose(child);
  return pid;
}

function waitForWorkerOutput(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; if (stdout === "true" || stdout === "false") resolve(stdout); });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (stdout === "true" || stdout === "false") resolve(stdout);
      else reject(new Error(stderr || `store worker exited ${code}`));
    });
  });
}

function waitForWorkerClose(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("close", () => resolve()));
}

async function seedDeadWorkdirLock(storage: string, workdir: string, agentPid: number | null = null): Promise<void> {
  const registry = path.join(storage, "coordination.git");
  const canonicalWorkdir = await realpath(workdir);
  const hostPid = await getExitedProcessId();
  const keyHash = createHash("sha256").update(`workdir:${canonicalWorkdir}`).digest("hex");
  await mkdir(storage, { recursive: true });
  execFileSync("git", ["init", "--bare", "--quiet", registry]);
  const record = JSON.stringify({
    schemaVersion: 1, token: "d87c4e10-09d1-40d6-9e55-62bc029940b9", kind: "workdir-lease",
    hostPid, agentPid, attemptId: "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e", workdir: canonicalWorkdir,
  });
  const oid = execFileSync("git", ["--git-dir", registry, "hash-object", "-w", "--stdin"], { input: record, encoding: "utf8" }).trim();
  execFileSync("git", ["--git-dir", registry, "update-ref", `refs/agilecampus/locks/${keyHash}`, oid, "0".repeat(40)]);
}

async function seedDeadAttemptRecordLock(storage: string, attemptId: string): Promise<void> {
  const registry = path.join(storage, "coordination.git");
  const keyHash = createHash("sha256").update(`attempt:${attemptId}`).digest("hex");
  const hostPid = await getExitedProcessId();
  await mkdir(storage, { recursive: true });
  execFileSync("git", ["init", "--bare", "--quiet", registry]);
  const record = JSON.stringify({
    schemaVersion: 1, token: "d87c4e10-09d1-40d6-9e55-62bc029940b9", kind: "attempt-update",
    hostPid, attemptId,
  });
  const oid = execFileSync("git", ["--git-dir", registry, "hash-object", "-w", "--stdin"], { input: record, encoding: "utf8" }).trim();
  execFileSync("git", ["--git-dir", registry, "update-ref", `refs/agilecampus/locks/${keyHash}`, oid, "0".repeat(40)]);
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

  it("allows only one process to reclaim a stale workdir ref via compare-and-swap", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-stale-lock-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    await seedDeadWorkdirLock(storage, workdir);

    const workers = [
      spawnStoreWorker(storage, "lease-hold", workdir, "d87c4e10-09d1-40d6-9e55-62bc029940b9"),
      spawnStoreWorker(storage, "lease-hold", workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e"),
      spawnStoreWorker(storage, "lease-hold", workdir, "00000000-0000-4000-8000-000000000001"),
    ];
    try {
      const outcomes = await Promise.all(workers.map(waitForWorkerOutput));
      expect(outcomes.filter((outcome) => outcome === "true")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === "false")).toHaveLength(2);
    } finally {
      for (const worker of workers) worker.kill("SIGKILL");
      await Promise.all(workers.map(waitForWorkerClose));
    }
  }, 15_000);

  it("keeps a lease when its Agent process is alive even if the extension host PID is stale", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-live-agent-lease-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    await seedDeadWorkdirLock(storage, workdir, process.pid);
    await expect(new AttemptStore(storage).acquireWorkdirLease(workdir, "00000000-0000-4000-8000-000000000001"))
      .resolves.toBe(false);
    await expect(readdir(path.join(storage, "attempt-locks"))).resolves.toEqual([]);
  });

  it("recovers a crashed local owner-marker write only when its dead lease ref proves ownership", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-incomplete-owner-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    const canonicalWorkdir = await realpath(workdir);
    const leaseId = createHash("sha256").update(canonicalWorkdir).digest("hex");
    const leasePath = path.join(storage, "attempt-locks", `${leaseId}.lock`);
    await seedDeadWorkdirLock(storage, workdir);
    await mkdir(leasePath, { recursive: true });
    await writeFile(path.join(leasePath, "owner.json.tmp-00000000-0000-4000-8000-000000000001"), "partial");

    const store = new AttemptStore(storage);
    await expect(store.acquireWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e")).resolves.toBe(true);
    await expect(readdir(leasePath)).resolves.toEqual(["owner.json"]);
    await store.releaseWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e");
    await expect(readdir(path.join(storage, "attempt-locks"))).resolves.toEqual([]);
  });

  it("migrates an abandoned pre-CAS owner directory without leaving reclaim artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-legacy-stale-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    const canonicalWorkdir = await realpath(workdir);
    const deadHostPid = await getExitedProcessId();
    const leaseId = createHash("sha256").update(canonicalWorkdir).digest("hex");
    const legacyLeasePath = path.join(storage, "attempt-locks", `${leaseId}.lock`);
    await mkdir(legacyLeasePath, { recursive: true });
    await writeFile(path.join(legacyLeasePath, "owner.json"), JSON.stringify({
      attemptId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", workdir: canonicalWorkdir,
      hostPid: deadHostPid, agentPid: null,
    }));

    const store = new AttemptStore(storage);
    await expect(store.acquireWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e")).resolves.toBe(true);
    expect(await readdir(path.join(storage, "attempt-locks"))).toEqual([`${leaseId}.lock`]);
    expect(await readdir(legacyLeasePath)).toEqual(["owner.json"]);
    await store.releaseWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e");
    await expect(readdir(legacyLeasePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(path.join(storage, "attempt-locks"))).resolves.toEqual([]);
  });

  it("migrates an abandoned sidecar lease left by the previous lock implementation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-legacy-sidecar-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    const canonicalWorkdir = await realpath(workdir);
    const deadHostPid = await getExitedProcessId();
    const leaseId = createHash("sha256").update(canonicalWorkdir).digest("hex");
    const legacyLeasePath = path.join(storage, "attempt-locks", `${leaseId}.lock`);
    const legacyOwnerPath = `${legacyLeasePath}.owner.json`;
    await mkdir(legacyLeasePath, { recursive: true });
    await writeFile(legacyOwnerPath, JSON.stringify({
      attemptId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", workdir: canonicalWorkdir,
      hostPid: deadHostPid, agentPid: null, token: "00000000-0000-4000-8000-000000000001",
    }));

    const store = new AttemptStore(storage);
    await expect(store.acquireWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e")).resolves.toBe(true);
    await expect(readFile(path.join(legacyLeasePath, "owner.json"), "utf8")).resolves.toContain("1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e");
    expect((await readdir(path.join(storage, "attempt-locks"))).some((entry) => entry.includes("reclaim"))).toBe(false);
    await store.releaseWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e");
    await expect(readdir(path.join(storage, "attempt-locks"))).resolves.toEqual([]);
  });

  it("removes a stale reclaim directory left by the previous lock library", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-orphan-reclaim-")); roots.push(root);
    const storage = path.join(root, "global");
    const workdir = path.join(root, "workspace"); await mkdir(workdir);
    const canonicalWorkdir = await realpath(workdir);
    const deadHostPid = await getExitedProcessId();
    const leaseId = createHash("sha256").update(canonicalWorkdir).digest("hex");
    const reclaimPath = path.join(storage, "attempt-locks", `${leaseId}.lock.reclaim-orphan`);
    await mkdir(reclaimPath, { recursive: true });
    await writeFile(path.join(reclaimPath, "owner.json"), JSON.stringify({
      attemptId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", workdir: canonicalWorkdir,
      hostPid: deadHostPid, agentPid: null,
    }));

    const store = new AttemptStore(storage);
    await expect(store.acquireWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e")).resolves.toBe(true);
    await expect(readdir(path.join(storage, "attempt-locks"))).resolves.toEqual([`${leaseId}.lock`]);
    await store.releaseWorkdirLease(workdir, "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e");
    await expect(readdir(path.join(storage, "attempt-locks"))).resolves.toEqual([]);
  });

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

  it("reclaims a stale Attempt-update ref before merging concurrent writers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-attempt-stale-record-lock-")); roots.push(root);
    const store = new AttemptStore(root);
    const attempt = await store.create({
      checkpointId: "d87c4e10-09d1-40d6-9e55-62bc029940b9", projectId: "project-a", taskId: "task-a",
      attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId: null, state: "running",
      workdir: "/tmp/worktree", branch: "main", baseSha: "a".repeat(40), parentAttemptId: null, pid: null, exitCode: null, timedOut: false,
    });
    await seedDeadAttemptRecordLock(root, attempt.id);
    await Promise.all([
      runStoreWorker(root, "update", attempt.id, JSON.stringify({ agentSummary: "recovered writer" })),
      runStoreWorker(root, "update", attempt.id, JSON.stringify({ testEvidence: "npm test: passed" })),
    ]);
    await expect(store.read(attempt.id)).resolves.toMatchObject({
      agentSummary: "recovered writer", testEvidence: "npm test: passed",
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
