import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { MEMORY_SNAPSHOT_MAX_BYTES, type ExtractionSnapshotV1, type MemoryScope } from "./types";
import { parseExtractionSnapshot, stableStringify } from "./input-snapshot";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MemorySnapshotStoreError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "MemorySnapshotStoreError"; }
}

/** Stores frozen source snapshots in the VS Code extension's private storage. */
export class MemorySnapshotStore {
  constructor(private readonly storageRoot: string) {}

  async saveSnapshot(value: ExtractionSnapshotV1): Promise<void> {
    const snapshot = parseExtractionSnapshot(value);
    const directory = await this.ensureDirectory();
    const destination = this.filePath(directory, snapshot.snapshotId);
    const bytes = Buffer.from(stableStringify(snapshot), "utf8");
    if (bytes.byteLength > MEMORY_SNAPSHOT_MAX_BYTES) throw new MemorySnapshotStoreError("SNAPSHOT_TOO_LARGE", "快照超过本机保存上限");
    try {
      const current = await this.readFile(destination);
      if (current.equals(bytes)) return;
      throw new MemorySnapshotStoreError("SNAPSHOT_ID_COLLISION", "相同快照 ID 已存在且内容不同；拒绝覆盖");
    } catch (error) {
      if (error instanceof MemorySnapshotStoreError || !isMissing(error)) throw error;
    }

    const temporary = path.join(directory, `.tmp-${snapshot.snapshotId}-${process.pid}-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await link(temporary, destination);
    } catch (error) {
      if (isAlreadyExists(error)) {
        const current = await this.readFile(destination);
        if (current.equals(bytes)) return;
        throw new MemorySnapshotStoreError("SNAPSHOT_ID_COLLISION", "并发写入了不同快照；拒绝覆盖");
      }
      throw new MemorySnapshotStoreError("SNAPSHOT_WRITE_FAILED", "快照未能原子保存；已有记录没有被替换");
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async loadSnapshot(snapshotId: string, expectedScope: MemoryScope): Promise<ExtractionSnapshotV1> {
    if (!UUID.test(snapshotId)) throw new MemorySnapshotStoreError("INVALID_ID", "快照标识无效");
    const directory = await this.ensureDirectory();
    const bytes = await this.readFile(this.filePath(directory, snapshotId));
    if (bytes.byteLength > MEMORY_SNAPSHOT_MAX_BYTES) throw new MemorySnapshotStoreError("SNAPSHOT_TOO_LARGE", "快照文件超过本机读取上限");
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")) as unknown; }
    catch { throw new MemorySnapshotStoreError("SNAPSHOT_CORRUPT", "快照 JSON 损坏"); }
    const snapshot = parseExtractionSnapshot(parsed);
    if (snapshot.snapshotId !== snapshotId) throw new MemorySnapshotStoreError("SNAPSHOT_ID_MISMATCH", "快照文件名与内容不一致");
    if (stableStringify(snapshot.scope) !== stableStringify(expectedScope)) {
      throw new MemorySnapshotStoreError("SCOPE_MISMATCH", "快照不属于当前服务、账号、工作区、项目或任务");
    }
    return snapshot;
  }

  private async ensureDirectory(): Promise<string> {
    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    const storageMetadata = await lstat(this.storageRoot);
    if (!storageMetadata.isDirectory() || storageMetadata.isSymbolicLink()) {
      throw new MemorySnapshotStoreError("UNSAFE_STORAGE", "扩展存储根目录不是安全目录");
    }
    const root = await realpath(this.storageRoot);
    const parent = path.join(root, "session-memory");
    const directory = path.join(parent, "snapshots");
    for (const target of [parent, directory]) {
      try { await mkdir(target, { recursive: false, mode: 0o700 }); }
      catch (error) { if (!isAlreadyExists(error)) throw new MemorySnapshotStoreError("UNSAFE_STORAGE", "无法创建私有快照目录"); }
      const metadata = await lstat(target);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new MemorySnapshotStoreError("UNSAFE_STORAGE", "快照目录包含符号链接或非目录项");
    }
    return directory;
  }

  private async readFile(file: string): Promise<Buffer> {
    try {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MEMORY_SNAPSHOT_MAX_BYTES) {
        throw new MemorySnapshotStoreError("UNSAFE_STORAGE", "快照目标不是安全的普通文件");
      }
      return await readFile(file);
    } catch (error) {
      if (error instanceof MemorySnapshotStoreError || !isMissing(error)) throw error;
      throw error;
    }
  }

  private filePath(directory: string, snapshotId: string): string {
    if (!UUID.test(snapshotId)) throw new MemorySnapshotStoreError("INVALID_ID", "快照标识无效");
    return path.join(directory, `${snapshotId}.json`);
  }
}

function isMissing(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT"; }
function isAlreadyExists(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST"; }
