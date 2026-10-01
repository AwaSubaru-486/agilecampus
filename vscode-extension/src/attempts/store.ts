import { createHash, randomUUID } from "node:crypto";
import lockfile = require("@bybrave/proper-lockfile2");
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export type AttemptState = "preparing" | "prepared" | "launching" | "running" | "finished" | "failed" | "awaiting_confirmation" | "unknown" | "ended_unverified";
export type AttemptKind = "single" | "parallel";
export type LocalAttempt = {
  id: string;
  checkpointId: string;
  projectId: string;
  taskId: string;
  attemptKind: AttemptKind;
  mode: "context-only";
  provider: "codex-cli";
  providerSessionId: string | null;
  state: AttemptState;
  startedAt: string;
  updatedAt: string;
  workdir: string;
  branch: string | null;
  baseSha: string | null;
  parentAttemptId: string | null;
  pid: number | null;
  exitCode: number | null;
  timedOut: boolean;
  hostPid?: number | null;
  agentSummary?: string | null;
  completionHeadSha?: string | null;
  completionDirty?: boolean | null;
  testEvidence?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activeStates = new Set<AttemptState>(["preparing", "launching", "running", "awaiting_confirmation", "unknown"]);

type WorkdirLease = { attemptId: string; workdir: string; hostPid: number; agentPid: number | null; token: string };
type ActiveWorkdirLease = { attemptId: string; token: string; release: () => Promise<void> };
const activeWorkdirLeases = new Map<string, ActiveWorkdirLease>();

export class AttemptStore {
  private readonly queues = new Map<string, Promise<void>>();
  constructor(private readonly root: string) {}

  async create(input: Omit<LocalAttempt, "id" | "startedAt" | "updatedAt">, id: string = randomUUID()): Promise<LocalAttempt> {
    if (!UUID.test(id)) throw new Error("Attempt ID 无效");
    const now = new Date().toISOString();
    const attempt: LocalAttempt = {
      ...input, id, startedAt: now, updatedAt: now,
      hostPid: input.hostPid ?? process.pid,
      agentSummary: input.agentSummary ?? null,
      completionHeadSha: input.completionHeadSha ?? null,
      completionDirty: input.completionDirty ?? null,
      testEvidence: input.testEvidence ?? null,
    };
    await this.writeNew(attempt);
    return attempt;
  }

  async update(id: string, patch: Partial<Pick<LocalAttempt,
    "providerSessionId" | "state" | "pid" | "exitCode" | "timedOut" | "workdir" | "branch" | "baseSha" |
    "agentSummary" | "completionHeadSha" | "completionDirty" | "testEvidence">>): Promise<LocalAttempt> {
    if (!UUID.test(id)) throw new Error("Attempt ID 无效");
    const previous = this.queues.get(id) ?? Promise.resolve();
    let updated!: LocalAttempt;
    const next = previous.then(async () => {
      const lockPath = this.recordLockPath(id);
      await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
      let compromised: Error | undefined;
      const release = await lockfile.lock(this.filePath(id), {
        realpath: false,
        lockfilePath: lockPath,
        stale: 10_000,
        update: 5_000,
        retries: { retries: 100, minTimeout: 10, maxTimeout: 100, maxRetryTime: 15_000 },
        onCompromised: (error) => { compromised = error; },
      });
      try {
        if (compromised) throw compromised;
        const current = await this.read(id);
        if (!current) throw new Error("Attempt 记录不存在");
        updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
        await this.write(updated);
        if (compromised) throw compromised;
      } finally {
        await release();
      }
    });
    this.queues.set(id, next);
    try { await next; return updated; }
    finally { if (this.queues.get(id) === next) this.queues.delete(id); }
  }

  async read(id: string): Promise<LocalAttempt | undefined> {
    if (!UUID.test(id)) throw new Error("Attempt ID 无效");
    const target = this.filePath(id);
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Attempt 记录不是普通文件");
      return parseAttempt(JSON.parse(await readFile(target, "utf8")));
    } catch (error) {
      if (isCode(error, "ENOENT")) return undefined;
      throw error instanceof Error ? error : new Error("无法读取 Attempt 记录");
    }
  }

  async list(): Promise<LocalAttempt[]> {
    let entries;
    try { entries = await readdir(this.directory()); }
    catch (error) { if (isCode(error, "ENOENT")) return []; throw error; }
    const items: LocalAttempt[] = [];
    for (const entry of entries) {
      const match = /^([0-9a-f-]{36})\.json$/i.exec(entry);
      if (!match) continue;
      const item = await this.read(match[1]);
      if (item) items.push(item);
    }
    return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async hasPotentiallyActiveAttemptInWorkdir(workdir: string, exceptAttemptId?: string): Promise<boolean> {
    const canonicalWorkdir = await canonicalPath(workdir);
    for (const attempt of await this.list()) {
      if (attempt.id === exceptAttemptId || !activeStates.has(attempt.state)) continue;
      if (await canonicalPath(attempt.workdir) === canonicalWorkdir) return true;
    }
    return false;
  }

  async hasPotentiallyActiveAttempt(checkpointId: string, attemptKind?: AttemptKind): Promise<boolean> {
    return (await this.list()).some((attempt) => attempt.checkpointId === checkpointId &&
      (attemptKind === undefined || attempt.attemptKind === attemptKind) && activeStates.has(attempt.state));
  }

  async markInterruptedUnknown(excludedIds: ReadonlySet<string> = new Set()): Promise<void> {
    for (const item of await this.list()) {
      if (excludedIds.has(item.id) || !["preparing", "launching", "running"].includes(item.state)) continue;
      if (item.pid !== null && item.pid !== undefined) {
        if (isRunningProcess(item.pid)) continue;
      } else if (item.hostPid !== null && item.hostPid !== undefined && isRunningProcess(item.hostPid)) continue;
      await this.update(item.id, { state: "unknown" });
    }
  }

  async acquireWorkdirLease(workdir: string, attemptId: string, onCompromised?: (error: Error) => void): Promise<boolean> {
    if (!UUID.test(attemptId)) throw new Error("Attempt ID 无效");
    const canonicalWorkdir = await realpath(workdir);
    await mkdir(this.leaseDirectory(), { recursive: true, mode: 0o700 });
    const leasePath = this.leasePath(canonicalWorkdir);
    if (await this.hasLiveLegacyLease(leasePath)) return false;
    const token = randomUUID();
    let compromised: Error | undefined;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(canonicalWorkdir, {
        realpath: false,
        lockfilePath: leasePath,
        stale: 30_000,
        update: 10_000,
        onCompromised: (error) => {
          compromised = error;
          if (activeWorkdirLeases.get(leasePath)?.token === token) activeWorkdirLeases.delete(leasePath);
          onCompromised?.(error);
        },
      });
    } catch (error) {
      if (isCode(error, "ELOCKED")) return false;
      throw error;
    }
    try {
      if (compromised) throw compromised;
      await this.writeLease(leasePath, { attemptId, workdir: canonicalWorkdir, hostPid: process.pid, agentPid: null, token });
      if (compromised) throw compromised;
      activeWorkdirLeases.set(leasePath, { attemptId, token, release });
      return true;
    } catch (error) {
      if (!compromised) await release().catch(() => undefined);
      throw error;
    }
  }

  async updateWorkdirLeaseProcess(workdir: string, attemptId: string, agentPid: number | null): Promise<void> {
    const leasePath = this.leasePath(await realpath(workdir));
    const owner = await this.readLease(this.leaseOwnerPath(leasePath));
    const active = activeWorkdirLeases.get(leasePath);
    if (!owner || owner.attemptId !== attemptId || !active || active.attemptId !== attemptId || active.token !== owner.token) {
      throw new Error("Agent 工作目录锁已失效；停止继续启动");
    }
    await this.writeLease(leasePath, { ...owner, agentPid });
  }

  async releaseWorkdirLease(workdir: string, attemptId: string): Promise<void> {
    const canonicalWorkdir = await canonicalPath(workdir);
    const leasePath = this.leasePath(canonicalWorkdir);
    const owner = await this.readLease(this.leaseOwnerPath(leasePath));
    if (!owner || owner.attemptId !== attemptId) return;
    const active = activeWorkdirLeases.get(leasePath);
    if (active?.attemptId === attemptId && active.token === owner.token) {
      await rm(this.leaseOwnerPath(leasePath), { force: true });
      activeWorkdirLeases.delete(leasePath);
      await active.release();
      return;
    }

    // A prior extension host may have exited without releasing its lease.
    // Reacquiring through the lock library reclaims it only after it is stale.
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(canonicalWorkdir, {
        realpath: false,
        lockfilePath: leasePath,
        stale: 30_000,
        update: 10_000,
      });
    } catch (error) {
      if (isCode(error, "ELOCKED")) return;
      throw error;
    }
    try {
      const current = await this.readLease(this.leaseOwnerPath(leasePath));
      if (current?.attemptId === attemptId && current.token === owner.token) {
        await rm(this.leaseOwnerPath(leasePath), { force: true });
      }
    } finally {
      await release();
    }
  }

  private async writeNew(attempt: LocalAttempt): Promise<void> {
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath(attempt.id)}.tmp-${randomUUID()}`;
    try {
      await writeFile(temp, JSON.stringify(attempt, null, 2), { flag: "wx", mode: 0o600 });
      await rename(temp, this.filePath(attempt.id));
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async write(attempt: LocalAttempt): Promise<void> {
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath(attempt.id)}.tmp-${randomUUID()}`;
    try {
      await writeFile(temp, JSON.stringify(attempt, null, 2), { flag: "wx", mode: 0o600 });
      await rename(temp, this.filePath(attempt.id));
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private directory(): string { return path.join(this.root, "attempts"); }
  private filePath(id: string): string { return path.join(this.directory(), `${id}.json`); }
  private leaseDirectory(): string { return path.join(this.root, "attempt-locks"); }
  private leasePath(workdir: string): string { return path.join(this.leaseDirectory(), `${createHash("sha256").update(workdir).digest("hex")}.lock`); }
  private leaseOwnerPath(leasePath: string): string { return `${leasePath}.owner.json`; }
  private recordLockPath(id: string): string { return path.join(this.root, "attempt-record-locks", `${id}.lock`); }

  private async readLease(file: string): Promise<WorkdirLease | undefined> {
    try {
      const item = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      if (typeof item.attemptId !== "string" || !UUID.test(item.attemptId) || typeof item.workdir !== "string" ||
          !path.isAbsolute(item.workdir) || !Number.isSafeInteger(item.hostPid) ||
          item.agentPid !== null && !Number.isSafeInteger(item.agentPid) || typeof item.token !== "string" || !UUID.test(item.token)) {
        throw new Error("Agent 工作目录锁内容无效；为避免并发写入，已停止启动。");
      }
      return item as WorkdirLease;
    } catch (error) {
      if (isCode(error, "ENOENT")) return undefined;
      throw error instanceof Error ? error : new Error("无法读取 Agent 工作目录锁");
    }
  }

  private async hasLiveLegacyLease(leasePath: string): Promise<boolean> {
    try {
      const item = JSON.parse(await readFile(path.join(leasePath, "owner.json"), "utf8")) as Record<string, unknown>;
      if (typeof item.attemptId !== "string" || !UUID.test(item.attemptId) || typeof item.workdir !== "string" ||
          !path.isAbsolute(item.workdir) || !Number.isSafeInteger(item.hostPid) ||
          item.agentPid !== null && !Number.isSafeInteger(item.agentPid)) {
        throw new Error("旧版 Agent 工作目录锁内容无效；为避免并发写入，已停止启动。");
      }
      return isRunningProcess(item.hostPid as number) || item.agentPid !== null && isRunningProcess(item.agentPid as number);
    } catch (error) {
      if (isCode(error, "ENOENT")) return false;
      throw error instanceof Error ? error : new Error("无法读取旧版 Agent 工作目录锁");
    }
  }

  private async writeLease(directory: string, owner: WorkdirLease): Promise<void> {
    const destination = this.leaseOwnerPath(directory);
    const temporary = `${destination}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function parseAttempt(value: unknown): LocalAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Attempt 记录格式无效");
  const item = value as Record<string, unknown>;
  const states: AttemptState[] = ["preparing", "prepared", "launching", "running", "finished", "failed", "awaiting_confirmation", "unknown", "ended_unverified"];
  if (typeof item.id !== "string" || !UUID.test(item.id) || typeof item.checkpointId !== "string" || !UUID.test(item.checkpointId) ||
      typeof item.projectId !== "string" || typeof item.taskId !== "string" || item.attemptKind !== undefined && !["single", "parallel"].includes(String(item.attemptKind)) ||
      item.mode !== "context-only" || item.provider !== "codex-cli" ||
      item.providerSessionId !== null && typeof item.providerSessionId !== "string" || !states.includes(item.state as AttemptState) ||
      typeof item.startedAt !== "string" || !Number.isFinite(Date.parse(item.startedAt)) || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt)) ||
      typeof item.workdir !== "string" || !path.isAbsolute(item.workdir) ||
      item.branch !== undefined && item.branch !== null && typeof item.branch !== "string" ||
      item.baseSha !== undefined && item.baseSha !== null && (typeof item.baseSha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(item.baseSha)) ||
      item.parentAttemptId !== undefined && item.parentAttemptId !== null && (typeof item.parentAttemptId !== "string" || !UUID.test(item.parentAttemptId)) ||
      item.pid !== null && !Number.isSafeInteger(item.pid) || item.hostPid !== undefined && item.hostPid !== null && !Number.isSafeInteger(item.hostPid) ||
      item.exitCode !== null && !Number.isSafeInteger(item.exitCode) || typeof item.timedOut !== "boolean") {
    throw new Error("Attempt 记录格式无效");
  }
  return {
    ...(item as unknown as LocalAttempt),
    attemptKind: item.attemptKind === "parallel" ? "parallel" : "single",
    branch: typeof item.branch === "string" ? item.branch : null,
    baseSha: typeof item.baseSha === "string" ? item.baseSha : null,
    parentAttemptId: typeof item.parentAttemptId === "string" ? item.parentAttemptId : null,
    hostPid: Number.isSafeInteger(item.hostPid) ? item.hostPid as number : null,
    agentSummary: typeof item.agentSummary === "string" ? item.agentSummary.slice(0, 24_000) : null,
    completionHeadSha: typeof item.completionHeadSha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(item.completionHeadSha) ? item.completionHeadSha : null,
    completionDirty: typeof item.completionDirty === "boolean" ? item.completionDirty : null,
    testEvidence: typeof item.testEvidence === "string" ? item.testEvidence.slice(0, 8_000) : null,
  };
}

async function canonicalPath(value: string): Promise<string> {
  try { return await realpath(value); }
  catch { return path.resolve(value); }
}

export function isRunningProcess(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return !isCode(error, "ESRCH"); }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
