import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
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

type WorkdirLease = { attemptId: string; workdir: string; hostPid: number; agentPid: number | null };

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
      const current = await this.read(id);
      if (!current) throw new Error("Attempt 记录不存在");
      updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await this.write(updated);
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

  async acquireWorkdirLease(workdir: string, attemptId: string): Promise<boolean> {
    if (!UUID.test(attemptId)) throw new Error("Attempt ID 无效");
    const canonicalWorkdir = await realpath(workdir);
    await mkdir(this.leaseDirectory(), { recursive: true, mode: 0o700 });
    const leasePath = this.leasePath(canonicalWorkdir);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await mkdir(leasePath, { mode: 0o700 });
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw error;
        const owner = await this.readLease(leasePath);
        if (owner && (isRunningProcess(owner.hostPid) || owner.agentPid !== null && isRunningProcess(owner.agentPid))) return false;
        if (!owner) {
          const info = await stat(leasePath).catch(() => undefined);
          if (info && Date.now() - info.mtimeMs < 60_000) return false;
        }
        const abandonedPath = `${leasePath}.abandoned-${randomUUID()}`;
        try {
          await rename(leasePath, abandonedPath);
          await rm(abandonedPath, { recursive: true, force: true });
        } catch (renameError) {
          if (!isCode(renameError, "ENOENT")) throw renameError;
        }
        continue;
      }
      try {
        await this.writeLease(leasePath, { attemptId, workdir: canonicalWorkdir, hostPid: process.pid, agentPid: null });
        return true;
      } catch (error) {
        await rm(leasePath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }
    return false;
  }

  async updateWorkdirLeaseProcess(workdir: string, attemptId: string, agentPid: number | null): Promise<void> {
    const leasePath = this.leasePath(await realpath(workdir));
    const owner = await this.readLease(leasePath);
    if (!owner || owner.attemptId !== attemptId) throw new Error("Agent 工作目录锁已失效；停止继续启动");
    await this.writeLease(leasePath, { ...owner, agentPid });
  }

  async releaseWorkdirLease(workdir: string, attemptId: string): Promise<void> {
    const leasePath = this.leasePath(await canonicalPath(workdir));
    const owner = await this.readLease(leasePath);
    if (!owner || owner.attemptId !== attemptId) return;
    const releasedPath = `${leasePath}.released-${randomUUID()}`;
    try {
      await rename(leasePath, releasedPath);
      await rm(releasedPath, { recursive: true, force: true });
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
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

  private async readLease(directory: string): Promise<WorkdirLease | undefined> {
    try {
      const item = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8")) as Record<string, unknown>;
      if (typeof item.attemptId !== "string" || !UUID.test(item.attemptId) || typeof item.workdir !== "string" ||
          !path.isAbsolute(item.workdir) || !Number.isSafeInteger(item.hostPid) ||
          item.agentPid !== null && !Number.isSafeInteger(item.agentPid)) {
        throw new Error("Agent 工作目录锁内容无效；为避免并发写入，已停止启动。");
      }
      return item as WorkdirLease;
    } catch (error) {
      if (isCode(error, "ENOENT")) return undefined;
      throw error instanceof Error ? error : new Error("无法读取 Agent 工作目录锁");
    }
  }

  private async writeLease(directory: string, owner: WorkdirLease): Promise<void> {
    const destination = path.join(directory, "owner.json");
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
