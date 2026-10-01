import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, utimes, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { GitRefLockStore, type CoordinationLock, type CoordinationLockRecord } from "./git-ref-lock";

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
type LegacyWorkdirLease = Omit<WorkdirLease, "token"> & { token?: string };
type ActiveWorkdirLease = {
  attemptId: string;
  token: string;
  lock: CoordinationLock;
  onCompromised?: (error: Error) => void;
  heartbeat: ReturnType<typeof setInterval>;
  heartbeatPending?: Promise<void>;
  queue: Promise<void>;
};
const activeWorkdirLeases = new Map<string, ActiveWorkdirLease>();

export class AttemptStore {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly coordination: GitRefLockStore;
  constructor(private readonly root: string) { this.coordination = new GitRefLockStore(root); }

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
      const lock = await this.acquireRecordLock(id);
      try {
        const current = await this.read(id);
        if (!current) throw new Error("Attempt 记录不存在");
        updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
        await this.write(updated);
      } finally {
        await lock.release();
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
    const key = this.workdirLockKey(canonicalWorkdir);
    const lock = await this.coordination.tryAcquire(key, {
      kind: "workdir-lease", hostPid: process.pid, attemptId, workdir: canonicalWorkdir, agentPid: null,
    }, workdirLeaseIsStale);
    if (!lock) return false;
    let sentinelCreated = false;
    try {
      const legacy = await this.readLegacyLease(leasePath);
      const recoveredCurrentLease = lock.recovered?.kind === "workdir-lease" && lock.recovered.workdir === canonicalWorkdir;
      if (legacy.present) {
        if (!legacy.owner && !recoveredCurrentLease) {
          throw new Error("检测到没有所有者记录的旧工作目录锁；为避免并发写入，请关闭其他 VS Code 窗口后再处理。");
        }
        if (legacy.owner && workdirLeaseIsLive(legacy.owner)) {
          await lock.release();
          return false;
        }
        await this.removeLegacyLease(leasePath, recoveredCurrentLease);
      }
      if (!await this.removeStaleReclaimArtifacts(leasePath, canonicalWorkdir)) {
        await lock.release();
        return false;
      }
      try {
        await mkdir(leasePath, { mode: 0o700 });
        sentinelCreated = true;
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw error;
        // An old extension host may be entering the legacy lock protocol at
        // the same time. Never infer ownership from an incomplete directory.
        const raced = await this.readLegacyLease(leasePath);
        if (raced.owner && workdirLeaseIsLive(raced.owner)) {
          await lock.release();
          return false;
        }
        throw new Error("旧版工作目录锁正在建立；本次没有启动 Agent，请稍后重试。");
      }
      await this.writeLease(leasePath, {
        attemptId, workdir: canonicalWorkdir, hostPid: process.pid, agentPid: null, token: lock.record.token,
      });
      const active: ActiveWorkdirLease = {
        attemptId, token: lock.record.token, lock, onCompromised,
        queue: Promise.resolve(),
        heartbeat: setInterval(() => {
          active.heartbeatPending = (active.heartbeatPending ?? Promise.resolve()).then(() => utimes(leasePath, new Date(), new Date())).catch((error: unknown) => {
            clearInterval(active.heartbeat);
            active.onCompromised?.(error instanceof Error ? error : new Error("Agent 工作目录兼容锁已失效"));
          });
        }, 5_000),
      };
      active.heartbeat.unref?.();
      activeWorkdirLeases.set(key, active);
      return true;
    } catch (error) {
      if (sentinelCreated) await this.removeLeaseSentinel(leasePath, lock.record.token).catch(() => undefined);
      await lock.release().catch(() => undefined);
      throw error;
    }
  }

  async updateWorkdirLeaseProcess(workdir: string, attemptId: string, agentPid: number | null): Promise<void> {
    const key = this.workdirLockKey(await realpath(workdir));
    const active = activeWorkdirLeases.get(key);
    if (!active || active.attemptId !== attemptId) {
      throw new Error("Agent 工作目录锁已失效；停止继续启动");
    }
    try {
      await enqueueLease(active, async () => {
        await active.lock.update({ agentPid });
        const canonicalWorkdir = await realpath(workdir);
        await this.writeLease(this.leasePath(canonicalWorkdir), {
          attemptId, workdir: canonicalWorkdir, hostPid: process.pid, agentPid, token: active.token,
        });
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("无法更新 Agent 工作目录锁");
      active.onCompromised?.(failure);
      throw failure;
    }
  }

  async releaseWorkdirLease(workdir: string, attemptId: string): Promise<void> {
    const canonicalWorkdir = await canonicalPath(workdir);
    const leasePath = this.leasePath(canonicalWorkdir);
    const key = this.workdirLockKey(canonicalWorkdir);
    const active = activeWorkdirLeases.get(key);
    if (active?.attemptId === attemptId) {
      await enqueueLease(active, async () => {
        clearInterval(active.heartbeat);
        await active.heartbeatPending?.catch(() => undefined);
        await this.removeLeaseSentinel(leasePath, active.token);
        await active.lock.release();
        activeWorkdirLeases.delete(key);
      });
      return;
    }

    const owner = await this.coordination.readLock(key);
    if (!owner || owner.kind !== "workdir-lease" || owner.attemptId !== attemptId || !workdirLeaseIsStale(owner)) return;
    const recovery = await this.coordination.tryAcquire(key, {
      kind: "workdir-lease", hostPid: process.pid, attemptId, workdir: canonicalWorkdir, agentPid: null,
    }, workdirLeaseIsStale);
    if (!recovery) return;
    try {
      const legacy = await this.readLegacyLease(leasePath);
      if (legacy.owner && workdirLeaseIsLive(legacy.owner)) return;
      if (legacy.present && !legacy.owner) {
        const recoveredCurrentLease = recovery.recovered?.kind === "workdir-lease" && recovery.recovered.workdir === canonicalWorkdir;
        if (!recoveredCurrentLease) throw new Error("过期锁缺少所有者记录；为避免误删，未清理旧锁目录。");
        await this.removeLegacyLease(leasePath, true);
      } else {
        await this.removeLeaseSentinel(leasePath, owner.token);
      }
    } finally {
      await recovery.release();
    }
  }

  private async acquireRecordLock(id: string): Promise<CoordinationLock> {
    const deadline = Date.now() + 15_000;
    let pause = 10;
    while (Date.now() < deadline) {
      const lock = await this.coordination.tryAcquire(`attempt:${id}`, {
        kind: "attempt-update", hostPid: process.pid, attemptId: id,
      }, (record) => !isRunningProcess(record.hostPid));
      if (lock) return lock;
      await delay(pause);
      pause = Math.min(100, pause + 10);
    }
    throw new Error("等待其他 VS Code 窗口更新 Attempt 超时；本次没有覆盖记录。");
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
  private leaseOwnerPath(leasePath: string): string { return path.join(leasePath, "owner.json"); }
  private legacySidecarPath(leasePath: string): string { return `${leasePath}.owner.json`; }
  private workdirLockKey(workdir: string): string { return `workdir:${workdir}`; }

  private async readLegacyLease(leasePath: string): Promise<{ present: boolean; owner?: LegacyWorkdirLease }> {
    let directoryPresent = false;
    try {
      const info = await lstat(leasePath);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("旧版 Agent 工作目录锁不是普通目录；为避免并发写入，已停止。");
      directoryPresent = true;
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }

    const owners: LegacyWorkdirLease[] = [];
    for (const file of [this.leaseOwnerPath(leasePath), this.legacySidecarPath(leasePath)]) {
      const owner = await this.readLegacyOwnerFile(file);
      if (owner) owners.push(owner);
    }
    if (owners.length > 1 && owners.some((owner) => !sameLeaseOwner(owner, owners[0]))) {
      throw new Error("检测到冲突的旧版工作目录锁记录；为避免并发写入，已停止。");
    }
    const owner = owners[0];
    return { present: directoryPresent || owners.length > 0, ...(owner ? { owner } : {}) };
  }

  private async removeLegacyLease(leasePath: string, allowIncompleteOwner = false): Promise<void> {
    try {
      const entries = await readdir(leasePath);
      const incompleteOwners = entries.filter((entry) => allowIncompleteOwner && /^owner\.json\.tmp-[0-9a-f-]{36}$/i.test(entry));
      const unknown = entries.filter((entry) => entry !== "owner.json" && !incompleteOwners.includes(entry));
      if (unknown.length) throw new Error("旧版工作目录锁包含未知文件；为避免删除用户数据，已停止。");
      for (const entry of incompleteOwners) await rm(path.join(leasePath, entry), { force: true });
      await rm(this.leaseOwnerPath(leasePath), { force: true });
      await rmdir(leasePath);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
    await rm(this.legacySidecarPath(leasePath), { force: true });
  }

  private async removeStaleReclaimArtifacts(leasePath: string, workdir: string): Promise<boolean> {
    let entries: string[];
    try { entries = await readdir(this.leaseDirectory()); }
    catch (error) { if (isCode(error, "ENOENT")) return true; throw error; }
    const prefix = `${path.basename(leasePath)}.reclaim-`;
    for (const entry of entries.filter((name) => name.startsWith(prefix))) {
      const reclaimPath = path.join(this.leaseDirectory(), entry);
      const info = await lstat(reclaimPath);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("旧版工作目录锁回收目录不是普通目录；为避免并发写入，已停止。");
      const owner = await this.readLegacyOwnerFile(path.join(reclaimPath, "owner.json"));
      if (!owner || owner.workdir !== workdir) throw new Error("旧版工作目录锁回收目录缺少匹配的所有者记录；为避免并发写入，已停止。");
      if (workdirLeaseIsLive(owner)) return false;
      const contents = await readdir(reclaimPath);
      if (contents.some((name) => name !== "owner.json")) {
        throw new Error("旧版工作目录锁回收目录包含未知文件；为避免删除用户数据，已停止。");
      }
      await rm(path.join(reclaimPath, "owner.json"), { force: true });
      await rmdir(reclaimPath);
    }
    return true;
  }

  private async readLegacyOwnerFile(file: string): Promise<LegacyWorkdirLease | undefined> {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) {
        throw new Error("旧版 Agent 工作目录锁文件无效；为避免并发写入，已停止。");
      }
      const item = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      if (typeof item.attemptId !== "string" || !UUID.test(item.attemptId) || typeof item.workdir !== "string" ||
          !path.isAbsolute(item.workdir) || !Number.isSafeInteger(item.hostPid) ||
          item.agentPid !== null && !Number.isSafeInteger(item.agentPid) ||
          item.token !== undefined && (typeof item.token !== "string" || !UUID.test(item.token))) {
        throw new Error("旧版 Agent 工作目录锁内容无效；为避免并发写入，已停止。");
      }
      return item as unknown as LegacyWorkdirLease;
    } catch (error) {
      if (isCode(error, "ENOENT")) return undefined;
      throw error instanceof Error ? error : new Error("无法读取旧版 Agent 工作目录锁");
    }
  }

  private async removeLeaseSentinel(leasePath: string, token: string): Promise<void> {
    const owner = await this.readLegacyLease(leasePath);
    if (!owner.present) return;
    if (owner.owner?.token !== token) throw new Error("Agent 工作目录锁所有者已变化；为避免删除其他锁，未释放目录记录。");
    await rm(this.leaseOwnerPath(leasePath), { force: true });
    await rmdir(leasePath);
    await rm(this.legacySidecarPath(leasePath), { force: true });
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

function workdirLeaseIsLive(owner: Pick<WorkdirLease, "hostPid" | "agentPid">): boolean {
  return isRunningProcess(owner.hostPid) || owner.agentPid !== null && isRunningProcess(owner.agentPid);
}

function enqueueLease<T>(active: ActiveWorkdirLease, operation: () => Promise<T>): Promise<T> {
  const next = active.queue.then(operation);
  active.queue = next.then(() => undefined, () => undefined);
  return next;
}

function workdirLeaseIsStale(record: CoordinationLockRecord): boolean {
  return !isRunningProcess(record.hostPid) && (record.agentPid === null || record.agentPid === undefined || !isRunningProcess(record.agentPid));
}

function sameLeaseOwner(left: LegacyWorkdirLease, right: LegacyWorkdirLease): boolean {
  return left.attemptId === right.attemptId && left.workdir === right.workdir && left.hostPid === right.hostPid &&
    left.agentPid === right.agentPid && left.token === right.token;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
