import { link, lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { parseMemoryDocumentV1 } from "../../../shared/session-memory/schema";
import type { MemoryDocumentV1 } from "../../../shared/session-memory/types";
import { parseHandoffMaterial, parseMemoryHandoffExport, type MemoryHandoffExportV1 } from "../../../shared/task-memory/transfer";
import { parseScope, sha256, stableStringify } from "./input-snapshot";
import type { MemoryHandoffMaterialV1, MemoryScope } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_HANDOFF_BYTES = 2 * 1024 * 1024;

export type { MemoryHandoffExportV1 } from "../../../shared/task-memory/transfer";
export { parseMemoryHandoffExport } from "../../../shared/task-memory/transfer";

/** Writes accepted memory and handoff material as immutable local artifacts. */
export class MemoryArtifactStore {
  constructor(private readonly storageRoot: string) {}

  async saveAcceptedDocument(value: MemoryDocumentV1, eventIds: ReadonlySet<string>): Promise<string> {
    const document = parseMemoryDocumentV1(value, eventIds);
    const directory = await this.ensureDirectory("accepted-memories");
    const file = path.join(directory, `${document.id}-r${document.revision}.json`);
    await writeImmutable(file, stableStringify(document));
    return file;
  }

  async saveHandoffMaterial(value: MemoryHandoffMaterialV1): Promise<string> {
    const material = parseHandoffMaterial(value);
    const directory = await this.ensureDirectory("handoff-materials");
    const file = path.join(directory, `${material.materialId}.json`);
    await writeImmutable(file, stableStringify(material));
    return file;
  }

  async export(value: MemoryHandoffExportV1, destination: string): Promise<void> {
    const { memory, material } = parseMemoryHandoffExport(value);
    const file = path.resolve(destination);
    await mkdir(path.dirname(file), { recursive: true });
    const bytes = Buffer.from(stableStringify({ format: value.format, schemaVersion: 1, memory, material }), "utf8");
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      // Export is user-directed. Do not silently overwrite a file that appeared after the save dialog.
      await link(temporary, file);
    } catch (error) {
      if (isAlreadyExists(error)) throw new Error("目标文件已存在；为避免覆盖，导出已取消");
      throw new Error("无法写出接班材料；原有文件未被替换");
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async saveReceivedExport(value: MemoryHandoffExportV1, receiverScope: MemoryScope): Promise<string> {
    const parsed = parseMemoryHandoffExport(value);
    const scope = parseScope(receiverScope);
    if (parsed.material.scope.serverOrigin !== scope.serverOrigin || parsed.material.scope.projectId !== scope.projectId || parsed.material.scope.taskId !== scope.taskId) {
      throw new Error("接班材料与当前服务、项目或任务不匹配");
    }
    const directory = await this.receivedDirectory(scope);
    const file = path.join(directory, `${parsed.material.materialId}.json`);
    const content = stableStringify(parsed);
    if (Buffer.byteLength(content, "utf8") > MAX_HANDOFF_BYTES) throw new Error("接班材料超过 2 MiB 限制");
    await writeImmutable(file, content);
    return file;
  }

  /** Task-level library, isolated by the authenticated actor and workspace; never falls back to another scope. */
  async listReceivedExports(receiverScope: Omit<MemoryScope, "sessionKey">): Promise<MemoryHandoffExportV1[]> {
    // Reuse scope validation; a task library spans sessions and does not persist this validation-only key.
    const scope = parseScope({ ...receiverScope, sessionKey: "00000000-0000-4000-8000-000000000000" });
    const directory = await this.receivedDirectory(scope);
    const records: MemoryHandoffExportV1[] = [];
    for (const entry of await readdir(directory)) {
      const match = /^([0-9a-f-]{36})\.json$/i.exec(entry);
      if (!match || !UUID.test(match[1])) continue;
      const file = path.join(directory, entry);
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_HANDOFF_BYTES) throw new Error("任务记忆材料文件无效");
      const bytes = await readFile(file);
      if (bytes.byteLength > MAX_HANDOFF_BYTES) throw new Error("任务记忆材料超过大小限制");
      const record = parseMemoryHandoffExport(JSON.parse(bytes.toString("utf8")));
      if (record.material.materialId !== match[1] || record.material.scope.serverOrigin !== scope.serverOrigin ||
          record.material.scope.projectId !== scope.projectId || record.material.scope.taskId !== scope.taskId) {
        throw new Error("任务记忆材料与当前范围不匹配");
      }
      records.push(record);
    }
    return records.sort((a, b) => b.memory.provenance.createdAt.localeCompare(a.memory.provenance.createdAt) ||
      b.material.materialId.localeCompare(a.material.materialId));
  }

  private async receivedDirectory(scope: MemoryScope): Promise<string> {
    const root = await this.ensureDirectory("received-handoffs");
    const ownerHash = sha256(stableStringify({ actorScope: scope.actorScope, workspaceScope: scope.workspaceScope, projectId: scope.projectId, taskId: scope.taskId }));
    const directory = path.join(root, ownerHash);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if (!isAlreadyExists(error)) throw error; }
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("接收材料目录不安全");
    return directory;
  }

  private async ensureDirectory(name: "accepted-memories" | "handoff-materials" | "received-handoffs"): Promise<string> {
    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    const storage = await lstat(this.storageRoot);
    if (!storage.isDirectory() || storage.isSymbolicLink()) throw new Error("扩展私有存储根目录不安全");
    const root = await realpath(this.storageRoot);
    const parent = path.join(root, "session-memory");
    const directory = path.join(parent, name);
    for (const target of [parent, directory]) {
      try { await mkdir(target, { mode: 0o700 }); }
      catch (error) { if (!isAlreadyExists(error)) throw error; }
      const metadata = await lstat(target);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("接班材料存储目录不安全");
    }
    return directory;
  }
}


export function createMemoryHandoffExport(memory: MemoryDocumentV1, material: MemoryHandoffMaterialV1): MemoryHandoffExportV1 {
  if (!UUID.test(memory.id) || !UUID.test(material.materialId)) throw new Error("接班材料标识无效");
  return { format: "agilecampus-memory-handoff", schemaVersion: 1, memory, material };
}

async function writeImmutable(file: string, content: string): Promise<void> {
  try {
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("目标已有不安全文件");
    if ((await readFile(file, "utf8")) === content) return;
    throw new Error("相同 ID 已有不同内容；拒绝覆盖历史版本");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await link(temporary, file);
  } catch (error) {
    if (isAlreadyExists(error)) {
      if ((await readFile(file, "utf8").catch(() => "")) === content) return;
      throw new Error("并发写入了不同的接班材料；拒绝覆盖");
    }
    throw error;
  } finally { await unlink(temporary).catch(() => undefined); }
}

function isMissing(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT"; }
function isAlreadyExists(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST"; }
