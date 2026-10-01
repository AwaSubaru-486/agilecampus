import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export type AttemptState = "launching" | "running" | "finished" | "failed" | "awaiting_confirmation" | "unknown";
export type LocalAttempt = {
  id: string;
  checkpointId: string;
  projectId: string;
  taskId: string;
  mode: "context-only";
  provider: "codex-cli";
  providerSessionId: string | null;
  state: AttemptState;
  startedAt: string;
  updatedAt: string;
  workdir: string;
  pid: number | null;
  exitCode: number | null;
  timedOut: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activeStates = new Set<AttemptState>(["launching", "running", "awaiting_confirmation", "unknown"]);

export class AttemptStore {
  private readonly queues = new Map<string, Promise<void>>();
  constructor(private readonly root: string) {}

  async create(input: Omit<LocalAttempt, "id" | "startedAt" | "updatedAt">): Promise<LocalAttempt> {
    const now = new Date().toISOString();
    const attempt: LocalAttempt = { ...input, id: randomUUID(), startedAt: now, updatedAt: now };
    await this.writeNew(attempt);
    return attempt;
  }

  async update(id: string, patch: Partial<Pick<LocalAttempt, "providerSessionId" | "state" | "pid" | "exitCode" | "timedOut">>): Promise<LocalAttempt> {
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

  async hasPotentiallyActiveAttempt(checkpointId: string): Promise<boolean> {
    return (await this.list()).some((attempt) => attempt.checkpointId === checkpointId && activeStates.has(attempt.state));
  }

  async markInterruptedUnknown(excludedIds: ReadonlySet<string> = new Set()): Promise<void> {
    for (const item of await this.list()) {
      if (!excludedIds.has(item.id) && (item.state === "launching" || item.state === "running")) {
        await this.update(item.id, { state: "unknown" });
      }
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
}

function parseAttempt(value: unknown): LocalAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Attempt 记录格式无效");
  const item = value as Record<string, unknown>;
  const states: AttemptState[] = ["launching", "running", "finished", "failed", "awaiting_confirmation", "unknown"];
  if (typeof item.id !== "string" || !UUID.test(item.id) || typeof item.checkpointId !== "string" || !UUID.test(item.checkpointId) ||
      typeof item.projectId !== "string" || typeof item.taskId !== "string" || item.mode !== "context-only" || item.provider !== "codex-cli" ||
      item.providerSessionId !== null && typeof item.providerSessionId !== "string" || !states.includes(item.state as AttemptState) ||
      typeof item.startedAt !== "string" || !Number.isFinite(Date.parse(item.startedAt)) || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt)) ||
      typeof item.workdir !== "string" || !path.isAbsolute(item.workdir) || item.pid !== null && !Number.isSafeInteger(item.pid) ||
      item.exitCode !== null && !Number.isSafeInteger(item.exitCode) || typeof item.timedOut !== "boolean") {
    throw new Error("Attempt 记录格式无效");
  }
  return item as unknown as LocalAttempt;
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
