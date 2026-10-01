import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parseWorkCheckpoint, CheckpointSchemaError } from "./schema";
import type { CheckpointListItem, NewCheckpointArtifact, WorkCheckpoint } from "./types";

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_ARTIFACTS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CheckpointStoreError extends Error {
  constructor(message: string) { super(message); this.name = "CheckpointStoreError"; }
}

export class CheckpointStore {
  constructor(private readonly storageRoot: string) {}

  async save(manifest: WorkCheckpoint, artifacts: NewCheckpointArtifact[]): Promise<WorkCheckpoint> {
    const cleanManifest = parseWorkCheckpoint({ ...manifest, artifacts: [] });
    if (artifacts.length > MAX_ARTIFACTS) throw new CheckpointStoreError("附件数量超过限制");
    let total = 0;
    const materialized = artifacts.map((artifact) => {
      const content = Buffer.from(artifact.content);
      if (content.byteLength > MAX_ARTIFACT_BYTES) throw new CheckpointStoreError("单个检查点附件超过 5 MiB");
      total += content.byteLength;
      if (total > MAX_TOTAL_BYTES) throw new CheckpointStoreError("检查点附件总量超过 10 MiB");
      const id = randomUUID();
      const extension = artifact.kind === "transcript" ? "transcript" : "json";
      return {
        id, kind: artifact.kind, content,
        relativePath: `artifacts/${id}.${extension}`,
        byteLength: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      } as const;
    });
    const storedManifest = parseWorkCheckpoint({
      ...cleanManifest,
      artifacts: materialized.map(({ id, kind, relativePath, byteLength, sha256 }) => ({ id, kind, relativePath, byteLength, sha256 })),
    });
    const parent = this.scopePath(storedManifest.serverOrigin, storedManifest.projectId);
    const destination = path.join(parent, storedManifest.id);
    const temporary = path.join(parent, `.${storedManifest.id}.tmp-${randomUUID()}`);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    try {
      await mkdir(temporary, { mode: 0o700 });
      await mkdir(path.join(temporary, "artifacts"), { mode: 0o700 });
      for (const artifact of materialized) {
        await writeFile(path.join(temporary, artifact.relativePath), artifact.content, { flag: "wx", mode: 0o600 });
      }
      await writeFile(path.join(temporary, "manifest.json"), JSON.stringify(storedManifest, null, 2), { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
      return storedManifest;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      if (isAlreadyExists(error)) throw new CheckpointStoreError("检查点 ID 已存在；原有检查点没有被覆盖");
      throw new CheckpointStoreError("检查点写入失败；未生成有效记录");
    }
  }

  async list(serverOrigin: string, projectId: string): Promise<CheckpointListItem[]> {
    const parent = this.scopePath(serverOrigin, projectId);
    let entries;
    try { entries = await readdir(parent, { withFileTypes: true }); }
    catch (error) { if (isMissing(error)) return []; throw new CheckpointStoreError("无法读取本地检查点列表"); }
    const records: CheckpointListItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      const item = await this.read(serverOrigin, projectId, entry.name);
      if (item) records.push({ manifest: item, integrity: "verified" });
    }
    return records.sort((a, b) => b.manifest.capturedAt.localeCompare(a.manifest.capturedAt));
  }

  async read(serverOrigin: string, projectId: string, checkpointId: string): Promise<WorkCheckpoint | undefined> {
    if (!UUID.test(checkpointId)) throw new CheckpointStoreError("检查点 ID 无效");
    const directory = path.join(this.scopePath(serverOrigin, projectId), checkpointId);
    let manifestInfo;
    try { manifestInfo = await lstat(path.join(directory, "manifest.json")); }
    catch (error) { if (isMissing(error)) return undefined; throw new CheckpointStoreError("无法读取检查点"); }
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new CheckpointStoreError("检查点清单不是普通文件");
    let manifest: WorkCheckpoint;
    try { manifest = parseWorkCheckpoint(JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))); }
    catch (error) {
      if (error instanceof CheckpointSchemaError) throw new CheckpointStoreError(error.message);
      throw new CheckpointStoreError("检查点清单损坏");
    }
    if (manifest.id !== checkpointId || manifest.serverOrigin !== serverOrigin || manifest.projectId !== projectId) {
      throw new CheckpointStoreError("检查点归属与本地存储位置不一致");
    }
    for (const artifact of manifest.artifacts) {
      const artifactPath = path.join(directory, artifact.relativePath);
      let info;
      try { info = await lstat(artifactPath); }
      catch { throw new CheckpointStoreError("检查点附件缺失"); }
      if (!info.isFile() || info.isSymbolicLink()) throw new CheckpointStoreError("检查点附件不是普通文件");
      const bytes = await readFile(artifactPath);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== artifact.byteLength || digest !== artifact.sha256) throw new CheckpointStoreError("检查点附件完整性校验失败");
    }
    return manifest;
  }

  async readArtifact(serverOrigin: string, projectId: string, checkpointId: string, artifactId: string): Promise<Buffer | undefined> {
    const manifest = await this.read(serverOrigin, projectId, checkpointId);
    if (!manifest) return undefined;
    const artifact = manifest.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return undefined;
    const bytes = await readFile(path.join(this.scopePath(serverOrigin, projectId), checkpointId, artifact.relativePath));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== artifact.byteLength || digest !== artifact.sha256) throw new CheckpointStoreError("检查点附件完整性校验失败");
    return bytes;
  }

  private scopePath(serverOrigin: string, projectId: string): string {
    return path.join(this.storageRoot, "checkpoints", hash(serverOrigin), hash(projectId));
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function isMissing(error: unknown): boolean { return isCode(error, "ENOENT"); }
function isAlreadyExists(error: unknown): boolean { return isCode(error, "EEXIST"); }
function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
