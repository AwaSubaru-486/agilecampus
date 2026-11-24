import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

const LOCK_NAMESPACE = "refs/agilecampus/locks";
const initialized = new Map<string, Promise<void>>();

export type CoordinationLockRecord = {
  schemaVersion: 1;
  token: string;
  kind: "attempt-update" | "workdir-lease" | "session-memory-write";
  hostPid: number;
  attemptId?: string;
  workdir?: string;
  agentPid?: number | null;
};

export type CoordinationLock = {
  record: CoordinationLockRecord;
  recovered?: CoordinationLockRecord;
  update(patch: Partial<Pick<CoordinationLockRecord, "agentPid">>): Promise<void>;
  release(): Promise<void>;
};

export class GitRefLockStore {
  private readonly repository: string;
  private readonly emptyTemplate: string;
  private readonly emptyGlobalConfig: string;
  private objectIdLength?: 40 | 64;

  constructor(private readonly root: string) {
    this.repository = path.join(root, "coordination.git");
    this.emptyTemplate = path.join(root, "git-empty-template");
    this.emptyGlobalConfig = path.join(root, "git-empty-config");
  }

  async tryAcquire(
    key: string,
    initial: Omit<CoordinationLockRecord, "schemaVersion" | "token">,
    stale: (record: CoordinationLockRecord) => boolean,
  ): Promise<CoordinationLock | undefined> {
    await this.ensureRepository();
    const ref = this.refFor(key);
    let recovered: CoordinationLockRecord | undefined;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await this.read(ref);
      if (existing) {
        if (!stale(existing.record)) return undefined;
        try {
          await this.git(["update-ref", "-d", ref, existing.oid]);
          recovered = existing.record;
        } catch {
          // The expected old object ID makes stale deletion a CAS. A competing
          // reclaimer or new owner changed the ref; reread before deciding.
        }
        continue;
      }

      const record: CoordinationLockRecord = {
        ...initial,
        schemaVersion: 1,
        token: randomUUID(),
      };
      const oid = await this.writeBlob(record);
      try {
        await this.git(["update-ref", ref, oid, "0".repeat(this.objectIdLength!)]);
        return this.createHandle(ref, record, recovered);
      } catch (error) {
        // Concurrent creators contend on Git's ref lock. If a ref now exists,
        // this caller lost normally; if it does not, surface the Git error
        // (including a leftover .lock file) instead of silently proceeding.
        if (await this.read(ref)) continue;
        throw new Error("无法写入本地协同锁；Git 引用锁可能被中断操作占用。", { cause: error });
      }
    }

    return undefined;
  }

  async readLock(key: string): Promise<CoordinationLockRecord | undefined> {
    await this.ensureRepository();
    return (await this.read(this.refFor(key)))?.record;
  }

  private createHandle(ref: string, firstRecord: CoordinationLockRecord, recovered?: CoordinationLockRecord): CoordinationLock {
    let record = firstRecord;
    let released = false;
    let queue: Promise<void> = Promise.resolve();
    const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
      const next = queue.then(operation);
      queue = next.then(() => undefined, () => undefined);
      return next;
    };

    return {
      get record() { return record; },
      ...(recovered ? { recovered } : {}),
      update: (patch) => enqueue(async () => {
        if (released) throw new Error("本地协同锁已释放");
        const current = await this.read(ref);
        if (!current || current.record.token !== record.token) throw new Error("本地协同锁已失效");
        const updated = { ...current.record, ...patch };
        const updatedOid = await this.writeBlob(updated);
        await this.git(["update-ref", ref, updatedOid, current.oid]);
        record = updated;
      }),
      release: () => enqueue(async () => {
        if (released) return;
        const current = await this.read(ref);
        if (current?.record.token === record.token) {
          // CAS against the latest metadata so a concurrent agentPid update
          // cannot make a valid release leave a permanent active ref behind.
          await this.git(["update-ref", "-d", ref, current.oid]);
        }
        released = true;
      }),
    };
  }

  private refFor(key: string): string {
    return `${LOCK_NAMESPACE}/${createHash("sha256").update(key).digest("hex")}`;
  }

  private async read(ref: string): Promise<{ oid: string; record: CoordinationLockRecord } | undefined> {
    let oid: string;
    try {
      oid = (await this.git(["rev-parse", "--verify", "--quiet", ref])).trim();
    } catch (error) {
      if (isExitCode(error, 1)) return undefined;
      throw error;
    }
    if (oid.length !== this.objectIdLength || !/^[0-9a-f]+$/i.test(oid)) {
      throw new Error("本地协同锁引用格式无效；为避免并发写入，已停止。");
    }

    let raw: string;
    try { raw = await this.git(["cat-file", "blob", oid]); }
    catch (error) { throw new Error("本地协同锁记录损坏；为避免并发写入，已停止。", { cause: error }); }
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch (error) { throw new Error("本地协同锁记录无法解析；为避免并发写入，已停止。", { cause: error }); }
    if (!isLockRecord(value)) throw new Error("本地协同锁记录字段无效；为避免并发写入，已停止。");
    return { oid, record: value };
  }

  private async writeBlob(record: CoordinationLockRecord): Promise<string> {
    const output = await this.git(["hash-object", "-w", "--stdin"], JSON.stringify(record));
    const oid = output.trim();
    if (oid.length !== this.objectIdLength || !/^[0-9a-f]+$/i.test(oid)) {
      throw new Error("Git 未返回符合本地仓库格式的协同锁对象 ID");
    }
    return oid;
  }

  private async ensureRepository(): Promise<void> {
    let task = initialized.get(this.repository);
    if (!task) {
      task = this.initializeRepository();
      initialized.set(this.repository, task);
      void task.catch(() => { if (initialized.get(this.repository) === task) initialized.delete(this.repository); });
    }
    await task;
    if (this.objectIdLength === undefined) {
      let objectFormat: string;
      try { objectFormat = (await this.git(["rev-parse", "--show-object-format"])).trim(); }
      catch (error) {
        throw new Error("无法识别本地协同锁仓库的 Git 对象格式；为避免损坏锁记录，已停止。", { cause: error });
      }
      if (objectFormat === "sha1") this.objectIdLength = 40;
      else if (objectFormat === "sha256") this.objectIdLength = 64;
      else throw new Error(`不支持本地协同锁仓库的 Git 对象格式：${objectFormat || "unknown"}`);
    }
  }

  private async initializeRepository(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(this.emptyTemplate, { recursive: true, mode: 0o700 });
    try { await writeFile(this.emptyGlobalConfig, "", { flag: "wx", mode: 0o600 }); }
    catch (error) { if (!isCode(error, "EEXIST")) throw error; }
    let lastError: unknown;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const bare = (await this.git(["rev-parse", "--is-bare-repository"])).trim();
        if (bare === "true") return;
      } catch (error) {
        if (isCode(error, "ENOENT")) throw new Error("Attempt 跨窗口互斥需要本机已安装 Git 命令行工具。", { cause: error });
      }
      try { await this.git(["init", "--bare", "--quiet", "--object-format=sha1", `--template=${this.emptyTemplate}`, this.repository]); }
      catch (error) {
        if (isCode(error, "ENOENT")) throw new Error("Attempt 跨窗口互斥需要本机已安装 Git 命令行工具。", { cause: error });
        lastError = error;
      }
      await delay(10 + Math.min(attempt * 5, 100));
    }
    throw new Error("无法初始化本地协同锁存储；请检查 Git 安装和 VS Code 全局存储目录权限。", { cause: lastError });
  }

  private async git(args: string[], input?: string): Promise<string> {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_COMMON_DIR;
    delete env.GIT_INDEX_FILE;
    delete env.GIT_OBJECT_DIRECTORY;
    delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    delete env.GIT_TEMPLATE_DIR;
    delete env.GIT_DEFAULT_HASH;
    delete env.GIT_CONFIG_COUNT;
    delete env.GIT_CONFIG_PARAMETERS;
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
    }
    env.GIT_CONFIG_NOSYSTEM = "1";
    env.GIT_CONFIG_GLOBAL = this.emptyGlobalConfig;
    const child = spawn("git", ["--git-dir", this.repository, ...args], { env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdin.on("error", () => undefined);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
      if (input === undefined) child.stdin.end();
      else child.stdin.end(input);
    });
    if (exitCode !== 0) throw Object.assign(new Error(stderr.trim() || `git exited ${exitCode}`), { exitCode });
    return stdout;
  }
}

function isLockRecord(value: unknown): value is CoordinationLockRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.token === "string" && /^[0-9a-f-]{36}$/i.test(record.token) &&
    (record.kind === "attempt-update" || record.kind === "workdir-lease" || record.kind === "session-memory-write") && Number.isSafeInteger(record.hostPid) &&
    (record.attemptId === undefined || typeof record.attemptId === "string") &&
    (record.workdir === undefined || typeof record.workdir === "string") &&
    (record.agentPid === undefined || record.agentPid === null || Number.isSafeInteger(record.agentPid));
}

function isExitCode(error: unknown, exitCode: number): boolean {
  return typeof error === "object" && error !== null && "exitCode" in error && (error as { exitCode?: unknown }).exitCode === exitCode;
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
