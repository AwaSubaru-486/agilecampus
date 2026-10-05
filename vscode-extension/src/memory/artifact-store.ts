import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { parseMemoryDocumentV1 } from "../../../shared/session-memory/schema";
import type { MemoryDocumentV1 } from "../../../shared/session-memory/types";
import { parseHandoffMaterial } from "./handoff-material";
import { parseScope, sha256, stableStringify } from "./input-snapshot";
import type { MemoryHandoffMaterialV1, MemoryScope } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MemoryHandoffExportV1 = {
  format: "agilecampus-memory-handoff";
  schemaVersion: 1;
  memory: MemoryDocumentV1;
  material: MemoryHandoffMaterialV1;
};

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
    const root = await this.ensureDirectory("received-handoffs");
    const ownerHash = sha256(stableStringify({ actorScope: scope.actorScope, workspaceScope: scope.workspaceScope, projectId: scope.projectId, taskId: scope.taskId }));
    const directory = path.join(root, ownerHash);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if (!isAlreadyExists(error)) throw error; }
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("接收材料目录不安全");
    const file = path.join(directory, `${parsed.material.materialId}.json`);
    await writeImmutable(file, stableStringify(parsed));
    return file;
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

export function parseMemoryHandoffExport(value: unknown): MemoryHandoffExportV1 {
  if (!isRecord(value) || value.format !== "agilecampus-memory-handoff" || value.schemaVersion !== 1 ||
      Object.keys(value).some((key) => key !== "format" && key !== "schemaVersion" && key !== "memory" && key !== "material")) {
    throw new Error("接班 JSON 格式或版本无效");
  }
  const material = parseHandoffMaterial(value.material);
  const memory = parseMemoryDocumentV1(value.memory);
  const evidence = new Map(material.evidenceIndex.map((item) => [item.itemId, [...item.eventIds].sort()]));
  const checkRefs = (itemId: string, refs: string[]) => {
    const indexed = evidence.get(itemId);
    if (!indexed || stableStringify([...refs].sort()) !== stableStringify(indexed)) throw new Error("记忆正文的出处与接班材料索引不一致");
  };
  for (const category of ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const) {
    for (const item of memory[category]) checkRefs(item.id, item.evidenceRefs);
  }
  for (const category of ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const) {
    const acceptedText = memory[category].filter((item) => item.disposition === "active").map((item) => item.text);
    if (stableStringify(material[category]) !== stableStringify(acceptedText)) {
      throw new Error("接班材料记忆内容与人工接受的记忆版本不一致");
    }
  }
  for (const [index, test] of memory.tests.entries()) checkRefs(`test:${index}`, test.evidenceRefs);
  for (const category of ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"] as const) {
    for (const item of memory[category].filter((entry) => entry.disposition === "uncertain")) {
      const indexed = material.uncertainItems.find((entry) => entry.category === category && entry.itemId === item.id);
      if (!indexed || indexed.text !== item.text || stableStringify([...indexed.eventIds].sort()) !== stableStringify([...item.evidenceRefs].sort())) {
        throw new Error("记忆正文的待核对条目与接班材料不一致");
      }
    }
  }
  const uncertainTestItems = material.uncertainItems.filter((item) => item.category === "tests");
  for (const uncertain of uncertainTestItems) {
    const index = Number(uncertain.itemId.slice("test:".length));
    const test = memory.tests[index];
    if (!uncertain.itemId.startsWith("test:") || !Number.isSafeInteger(index) || !test || uncertain.text !== test.command ||
        stableStringify([...uncertain.eventIds].sort()) !== stableStringify([...test.evidenceRefs].sort())) {
      throw new Error("记忆正文的待核对测试与接班材料不一致");
    }
  }
  const uncertainTestIndexes = new Set(uncertainTestItems.map((item) => item.itemId));
  const activeMemoryTests = memory.tests.filter((_test, index) => !uncertainTestIndexes.has(`test:${index}`));
  if (stableStringify(activeMemoryTests) !== stableStringify(material.tests)) throw new Error("记忆正文的测试记录与接班材料不一致");
  if (memory.id !== material.memoryId || memory.revision !== material.revision ||
      memory.projectId !== material.scope.projectId || memory.taskId !== material.scope.taskId ||
      memory.sessionKey !== material.scope.sessionKey || memory.code.repositoryKeyHash !== material.repositoryKeyHash ||
      memory.code.headSha !== material.baseSha || memory.sourceCoverage.fromSequence !== material.sourceRange.from ||
      memory.sourceCoverage.toSequence !== material.sourceRange.to ||
      stableStringify(memory.sourceCoverage.gaps) !== stableStringify(material.sourceRange.gaps)) {
    throw new Error("导出包中的记忆与接班材料不匹配");
  }
  return { format: "agilecampus-memory-handoff", schemaVersion: 1, memory, material };
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
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
