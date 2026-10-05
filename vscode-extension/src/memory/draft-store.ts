import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parseMemoryDocumentV1 } from "../../../shared/session-memory/schema";
import type { MemoryDocumentV1, MemoryItemV1 } from "../../../shared/session-memory/types";
import { GitRefLockStore } from "../attempts/git-ref-lock";
import { parseScope, stableStringify } from "./input-snapshot";
import type {
  CandidateItem, CandidateTest, DraftCategory, DraftItem, DraftTest, ExtractionSnapshotV1,
  MemoryCandidateV1, MemoryDraftV1, MemoryScope, PreparedExtractionInputV1,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const CATEGORIES: DraftCategory[] = ["goal", "constraints", "completed", "remaining", "decisions", "rejectedApproaches", "blockers", "nextActions"];

export class MemoryDraftError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "MemoryDraftError"; }
}

export type MemoryDraftPatch =
  | { type: "edit-item"; category: DraftCategory; itemId: string; text: string }
  | { type: "delete-item"; category: DraftCategory; itemId: string }
  | { type: "add-item"; category: DraftCategory; text: string; evidenceRefs?: string[] }
  | { type: "edit-test"; testId: string; command: string; exitCode: number | null }
  | { type: "delete-test"; testId: string }
  | { type: "add-test"; command: string; exitCode: number | null; evidenceRefs: string[]; support: CandidateTest["support"] };

type CurrentPointer = { schemaVersion: 1; draftId: string; revision: number };

/** Append-only local draft revisions with per-draft cross-process locking. */
export class MemoryDraftStore {
  private readonly locks: GitRefLockStore;
  constructor(private readonly storageRoot: string, private readonly now: () => Date = () => new Date(), private readonly makeId = randomUUID) {
    this.locks = new GitRefLockStore(storageRoot);
  }

  async createDraft(
    candidate: MemoryCandidateV1,
    input: PreparedExtractionInputV1,
    snapshot: ExtractionSnapshotV1,
    options: { parentMemoryId?: string | null; parentDraft?: MemoryDraftV1 } = {},
  ): Promise<MemoryDraftV1> {
    assertSources(candidate, input, snapshot);
    const parentMemoryId = options.parentDraft?.memoryId ?? options.parentMemoryId ?? null;
    if (!(parentMemoryId === null || UUID.test(parentMemoryId))) throw new MemoryDraftError("INVALID_PARENT", "父记忆版本标识无效");
    if (options.parentDraft && (options.parentDraft.status !== "accepted" || options.parentDraft.memoryId !== parentMemoryId ||
        !sameScope(options.parentDraft.scope, snapshot.scope))) {
      throw new MemoryDraftError("INVALID_PARENT", "只有同一账号、工作区、项目与任务的已接受版本可以继承");
    }
    const draftId = this.makeId();
    const timestamp = this.now().toISOString();
    const items = {} as Record<DraftCategory, DraftItem[]>;
    for (const category of CATEGORIES) items[category] = candidate[category].map((item) => asDraftItem(category, item));
    const tests = candidate.tests.map(asDraftTest);
    const tombstones = options.parentDraft ? [...options.parentDraft.tombstones] : [];
    if (options.parentDraft) inheritAcceptedHumanEdits(items, tests, tombstones, options.parentDraft, snapshot, this.makeId);
    const draft: MemoryDraftV1 = {
      schemaVersion: 1, draftId, memoryId: this.makeId(), revision: 1, parentMemoryId,
      snapshotId: snapshot.snapshotId, inputCoverage: { capturedEventIds: [...input.capturedEventIds], omissions: structuredClone(input.omissions) },
      scope: snapshot.scope, inputDigest: input.inputDigest,
      status: "candidate", createdAt: timestamp, updatedAt: timestamp,
      provenance: { extractor: "agilecampus-session-memory", promptVersion: input.promptVersion, model: candidate.model,
        inputTokens: candidate.inputTokens, outputTokens: candidate.outputTokens },
      items, tests, tombstones,
    };
    return this.withLock(draftId, async () => {
      await this.writeRevision(draft);
      await this.writePointer(draft);
      return draft;
    });
  }

  async listDrafts(scope: MemoryScope): Promise<MemoryDraftV1[]> {
    const directory = await this.ensureRoot();
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(directory, { withFileTypes: true }));
    const drafts: MemoryDraftV1[] = [];
    for (const entry of entries) {
      if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const draft = await this.loadCurrent(entry.name);
      if (sameScope(draft.scope, scope)) drafts.push(draft);
    }
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDraft(draftId: string, expectedScope: MemoryScope): Promise<MemoryDraftV1> {
    assertUuid(draftId);
    const draft = await this.loadCurrent(draftId);
    if (!sameScope(draft.scope, parseScope(expectedScope))) throw new MemoryDraftError("SCOPE_MISMATCH", "草稿不属于当前账号、工作区、项目或任务");
    return draft;
  }

  async applyDraftPatch(
    draftId: string,
    expectedRevision: number,
    patch: MemoryDraftPatch,
    snapshot: ExtractionSnapshotV1,
  ): Promise<MemoryDraftV1> {
    assertUuid(draftId);
    return this.withLock(draftId, async () => {
      const current = await this.loadCurrent(draftId);
      if (current.revision !== expectedRevision) throw new MemoryDraftError("REVISION_CONFLICT", "草稿已被另一处修改；请重新载入最新版本");
      if (current.status === "accepted") throw new MemoryDraftError("DRAFT_ACCEPTED", "已接受的版本不可修改；请基于它创建新版本");
      assertSnapshotScope(current, snapshot);
      const next = structuredClone(current);
      next.revision += 1;
      next.updatedAt = this.now().toISOString();
      switch (patch.type) {
        case "edit-item": {
          const item = next.items[patch.category].find((entry) => entry.id === patch.itemId);
          if (!item) throw new MemoryDraftError("ITEM_NOT_FOUND", "找不到待修改的记忆条目");
          const text = validateText(patch.text);
          item.text = text;
          item.origin = "human";
          break;
        }
        case "delete-item": {
          const list = next.items[patch.category];
          const index = list.findIndex((entry) => entry.id === patch.itemId);
          if (index < 0) throw new MemoryDraftError("ITEM_NOT_FOUND", "找不到待删除的记忆条目");
          const [removed] = list.splice(index, 1);
          const identity = itemIdentity(patch.category, removed.text);
          next.tombstones = unique([...next.tombstones, removed.candidateKey ?? identity, identity]);
          break;
        }
        case "add-item": {
          const text = validateText(patch.text);
          const evidenceRefs = validateRefs(patch.evidenceRefs ?? [], snapshot);
          const sourceKinds = evidenceRefs.map((id) => snapshot.events.find((event) => event.id === id)?.kind);
          const support = sourceKinds.some((kind) => kind === "user" || kind === "assistant")
            ? "reported" as const : evidenceRefs.length ? "captured" as const : "inferred" as const;
          next.items[patch.category].push({
            id: this.makeId(), text, evidenceRefs, support,
            origin: "human", candidateKey: null, disposition: "active",
          });
          break;
        }
        case "edit-test": {
          const test = next.tests.find((entry) => entry.id === patch.testId);
          if (!test) throw new MemoryDraftError("TEST_NOT_FOUND", "找不到待修改的测试记录");
          const validated = validateManualTest({
            type: "add-test", command: patch.command, exitCode: patch.exitCode,
            evidenceRefs: test.evidenceRefs, support: test.support,
          }, snapshot);
          test.command = validated.command;
          test.exitCode = validated.exitCode;
          test.origin = "human";
          break;
        }
        case "delete-test": {
          const index = next.tests.findIndex((entry) => entry.id === patch.testId);
          if (index < 0) throw new MemoryDraftError("TEST_NOT_FOUND", "找不到待删除的测试记录");
          const [removed] = next.tests.splice(index, 1);
          const identity = testIdentity(removed.command, removed.exitCode);
          next.tombstones = unique([...next.tombstones, removed.candidateKey ?? identity, identity]);
          break;
        }
        case "add-test": {
          const candidate = validateManualTest(patch, snapshot);
          next.tests.push({ ...candidate, id: this.makeId(), origin: "human", candidateKey: null, disposition: "active" });
          break;
        }
      }
      await this.writeRevision(next);
      await this.writePointer(next);
      return next;
    });
  }

  async mergeCandidate(
    draftId: string,
    expectedRevision: number,
    candidate: MemoryCandidateV1,
    input: PreparedExtractionInputV1,
    snapshot: ExtractionSnapshotV1,
  ): Promise<MemoryDraftV1> {
    assertSources(candidate, input, snapshot);
    assertUuid(draftId);
    return this.withLock(draftId, async () => {
      const current = await this.loadCurrent(draftId);
      if (current.revision !== expectedRevision) throw new MemoryDraftError("REVISION_CONFLICT", "草稿已更新；请先载入最新版本");
      if (current.status === "accepted") throw new MemoryDraftError("DRAFT_ACCEPTED", "已接受的记忆版本不可被新提炼改写");
      if (current.inputDigest !== input.inputDigest || current.snapshotId !== snapshot.snapshotId || !sameScope(current.scope, snapshot.scope)) {
        throw new MemoryDraftError("INPUT_CHANGED", "新的提炼输入范围不同；请另建一个记忆版本，不能合并到旧草稿");
      }
      const next = structuredClone(current);
      next.revision += 1;
      next.updatedAt = this.now().toISOString();
      for (const category of CATEGORIES) {
        const nextItems = candidate[category].map((item) => asDraftItem(category, item));
        const currentByKey = new Map(next.items[category].filter((item) => item.candidateKey).map((item) => [item.candidateKey!, item]));
        for (const item of next.items[category]) {
          if (item.origin === "extracted" && item.candidateKey && !nextItems.some((candidateItem) => candidateItem.candidateKey === item.candidateKey)) {
            item.disposition = "uncertain";
          }
        }
        const merged = [...next.items[category]];
        for (const item of nextItems) {
          if (next.tombstones.includes(item.candidateKey!)) continue;
          const existing = currentByKey.get(item.candidateKey!);
          if (existing) {
            if (existing.origin === "extracted") Object.assign(existing, item, { id: existing.id });
            continue;
          }
          merged.push(item);
        }
        next.items[category] = merged;
      }
      const candidateTests = candidate.tests.map(asDraftTest);
      const priorByKey = new Map(next.tests.filter((item) => item.candidateKey).map((item) => [item.candidateKey!, item]));
      for (const item of next.tests) if (item.origin === "extracted" && item.candidateKey && !candidateTests.some((candidateItem) => candidateItem.candidateKey === item.candidateKey)) item.disposition = "uncertain";
      for (const item of candidateTests) {
        if (next.tombstones.includes(item.candidateKey!)) continue;
        const existing = priorByKey.get(item.candidateKey!);
        if (existing) { if (existing.origin === "extracted") Object.assign(existing, item, { id: existing.id }); }
        else next.tests.push(item);
      }
      next.provenance = { ...next.provenance, model: candidate.model, inputTokens: candidate.inputTokens, outputTokens: candidate.outputTokens };
      await this.writeRevision(next);
      await this.writePointer(next);
      return next;
    });
  }

  async acceptDraft(draftId: string, expectedRevision: number, snapshot: ExtractionSnapshotV1): Promise<{ draft: MemoryDraftV1; document: MemoryDocumentV1 }> {
    assertUuid(draftId);
    return this.withLock(draftId, async () => {
      const current = await this.loadCurrent(draftId);
      if (current.revision !== expectedRevision) throw new MemoryDraftError("REVISION_CONFLICT", "草稿已被另一处修改；请重新载入最新版本");
      if (current.status === "accepted") throw new MemoryDraftError("DRAFT_ACCEPTED", "该记忆版本已接受");
      assertSnapshotScope(current, snapshot);
      const draft = structuredClone(current);
      draft.revision += 1;
      draft.updatedAt = this.now().toISOString();
      draft.status = "accepted";
      const document = toMemoryDocument(draft, snapshot);
      await this.writeRevision(draft);
      await this.writePointer(draft);
      return { draft, document };
    });
  }

  private async loadCurrent(draftId: string): Promise<MemoryDraftV1> {
    const directory = await this.draftDirectory(draftId, false);
    const pointerFile = path.join(directory, "current.json");
    const pointer = parsePointer(await this.readJson(pointerFile));
    if (pointer.draftId !== draftId) throw new MemoryDraftError("DRAFT_CORRUPT", "草稿索引指向其他記忆");
    return parseDraft(await this.readJson(this.revisionPath(directory, pointer.revision)));
  }

  private async withLock<T>(draftId: string, operation: () => Promise<T>): Promise<T> {
    const root = await this.ensureRoot();
    const deadline = Date.now() + 5000;
    let pause = 10;
    while (Date.now() < deadline) {
      const lock = await this.locks.tryAcquire(`memory-draft:${root}:${draftId}`, { kind: "session-memory-write", hostPid: process.pid }, (record) => !isRunningProcess(record.hostPid));
      if (lock) {
        try { return await operation(); } finally { await lock.release(); }
      }
      await new Promise((resolve) => setTimeout(resolve, pause));
      pause = Math.min(100, pause + 10);
    }
    throw new MemoryDraftError("LOCK_TIMEOUT", "草稿正在被另一处修改，请稍后重试");
  }

  private async ensureRoot(): Promise<string> {
    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.storageRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new MemoryDraftError("UNSAFE_STORAGE", "扩展存储目录无效");
    const root = await realpath(this.storageRoot);
    const parent = path.join(root, "session-memory");
    const drafts = path.join(parent, "memory-drafts");
    for (const directory of [parent, drafts]) {
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error) { if (!isAlreadyExists(error)) throw error; }
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new MemoryDraftError("UNSAFE_STORAGE", "草稿目录必须是普通私有目录");
    }
    return drafts;
  }

  private async draftDirectory(draftId: string, create: boolean): Promise<string> {
    assertUuid(draftId);
    const root = await this.ensureRoot();
    const directory = path.join(root, draftId);
    if (create) {
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error) { if (!isAlreadyExists(error)) throw error; }
    }
    const metadata = await lstat(directory).catch(() => null);
    if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new MemoryDraftError("DRAFT_NOT_FOUND", "本地记忆草稿不存在或路径不安全");
    return directory;
  }

  private async writeRevision(draft: MemoryDraftV1): Promise<void> {
    const directory = await this.draftDirectory(draft.draftId, true);
    await writeImmutable(this.revisionPath(directory, draft.revision), stableStringify(parseDraft(draft)));
  }

  private async writePointer(draft: MemoryDraftV1): Promise<void> {
    const directory = await this.draftDirectory(draft.draftId, true);
    const destination = path.join(directory, "current.json");
    const temporary = path.join(directory, `.current-${this.makeId()}.tmp`);
    try {
      await writeFile(temporary, stableStringify({ schemaVersion: 1, draftId: draft.draftId, revision: draft.revision }), { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  private async readJson(file: string): Promise<unknown> {
    const metadata = await lstat(file).catch(() => null);
    if (!metadata || !metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024) throw new MemoryDraftError("DRAFT_CORRUPT", "本地记忆草稿文件无效");
    try { return JSON.parse(await readFile(file, "utf8")) as unknown; }
    catch { throw new MemoryDraftError("DRAFT_CORRUPT", "本地记忆草稿 JSON 损坏"); }
  }

  private revisionPath(directory: string, revision: number): string { return path.join(directory, `revision-${String(revision).padStart(8, "0")}.json`); }
}

/** Reconstruct the strict V1 document from a previously accepted, immutable draft. */
export function buildAcceptedMemoryDocument(draft: MemoryDraftV1, snapshot: ExtractionSnapshotV1): MemoryDocumentV1 {
  if (draft.status !== "accepted") throw new MemoryDraftError("DRAFT_NOT_ACCEPTED", "只有已接受的记忆版本可以导出");
  assertSnapshotScope(draft, snapshot);
  return toMemoryDocument(draft, snapshot);
}

function inheritAcceptedHumanEdits(
  items: Record<DraftCategory, DraftItem[]>,
  tests: DraftTest[],
  tombstones: string[],
  parent: MemoryDraftV1,
  snapshot: ExtractionSnapshotV1,
  makeId: () => string,
): void {
  const eventIds = new Set(snapshot.events.map((event) => event.id));
  for (const category of CATEGORIES) {
    items[category] = items[category].filter((item) => !tombstones.includes(itemIdentity(category, item.text)) &&
      !(item.candidateKey && tombstones.includes(item.candidateKey)));
    for (const previous of parent.items[category].filter((item) => item.origin === "human" && item.disposition !== "superseded")) {
      const evidenceRefs = previous.evidenceRefs.filter((id) => eventIds.has(id));
      const missingEvidence = evidenceRefs.length !== previous.evidenceRefs.length;
      const inherited: DraftItem = {
        ...structuredClone(previous),
        id: makeId(),
        evidenceRefs,
        support: missingEvidence ? "inferred" : previous.support,
        disposition: missingEvidence ? "uncertain" : previous.disposition,
      };
      const matchIndex = items[category].findIndex((item) =>
        Boolean(previous.candidateKey && item.candidateKey === previous.candidateKey) ||
        normalizeText(item.text) === normalizeText(previous.text));
      if (matchIndex >= 0) {
        inherited.candidateKey ??= items[category][matchIndex].candidateKey;
        items[category].splice(matchIndex, 1, inherited);
      } else items[category].push(inherited);
    }
  }

  const filteredTests = tests.filter((item) => !tombstones.includes(testIdentity(item.command, item.exitCode)) &&
    !(item.candidateKey && tombstones.includes(item.candidateKey)));
  tests.splice(0, tests.length, ...filteredTests);
  const inheritedTests: DraftTest[] = [];
  for (const previous of parent.tests.filter((item) => item.origin === "human" && item.disposition !== "superseded")) {
    const evidenceRefs = previous.evidenceRefs.filter((id) => eventIds.has(id));
    const missingEvidence = evidenceRefs.length !== previous.evidenceRefs.length;
    const inherited: DraftTest = {
      ...structuredClone(previous),
      id: makeId(),
      evidenceRefs,
      support: missingEvidence && previous.support === "captured" ? "reported" : previous.support,
      disposition: missingEvidence ? "uncertain" : previous.disposition,
    };
    const matchIndex = tests.findIndex((item) =>
      Boolean(previous.candidateKey && item.candidateKey === previous.candidateKey) ||
      normalizeText(item.command) === normalizeText(previous.command) && item.exitCode === previous.exitCode);
    if (matchIndex >= 0) {
      inherited.candidateKey ??= tests[matchIndex].candidateKey;
      tests.splice(matchIndex, 1, inherited);
    } else inheritedTests.push(inherited);
  }
  tests.push(...inheritedTests);
}

function asDraftItem(category: DraftCategory, item: CandidateItem): DraftItem {
  const candidateKey = itemIdentity(category, item.text);
  return { ...structuredClone(item), id: randomUUID(), origin: "extracted", candidateKey, disposition: "active" };
}
function asDraftTest(item: CandidateTest): DraftTest {
  const candidateKey = testIdentity(item.command, item.exitCode);
  return { ...structuredClone(item), id: randomUUID(), origin: "extracted", candidateKey, disposition: "active" };
}
function itemIdentity(category: DraftCategory, value: string): string { return digest({ category, text: normalizeText(value) }); }
function testIdentity(command: string, exitCode: number | null): string { return digest({ command: normalizeText(command), exitCode }); }

function parseDraft(value: unknown): MemoryDraftV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !UUID.test(text(value.draftId)) || !UUID.test(text(value.memoryId)) ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
      !(value.parentMemoryId === null || UUID.test(text(value.parentMemoryId))) || !UUID.test(text(value.snapshotId)) ||
      !isRecord(value.inputCoverage) || !Array.isArray(value.inputCoverage.capturedEventIds) || !Array.isArray(value.inputCoverage.omissions) ||
      !HASH.test(text(value.inputDigest)) || !["candidate", "accepted"].includes(text(value.status)) ||
      !Number.isFinite(Date.parse(text(value.createdAt))) || !Number.isFinite(Date.parse(text(value.updatedAt))) || !isRecord(value.provenance) ||
      !isRecord(value.items) || !Array.isArray(value.tests) || !Array.isArray(value.tombstones)) {
    throw new MemoryDraftError("DRAFT_CORRUPT", "本地记忆草稿字段无效");
  }
  const scope = parseScope(value.scope);
  const inputCoverage = value.inputCoverage as Record<string, unknown>;
  const capturedEventIds = inputCoverage.capturedEventIds as unknown[];
  const omissions = inputCoverage.omissions as unknown[];
  if (!capturedEventIds.every((id) => typeof id === "string" && UUID.test(id)) || new Set(capturedEventIds).size !== capturedEventIds.length ||
      !omissions.every((item) => isRecord(item) && UUID.test(text(item.eventId)) && Number.isSafeInteger(item.sequence) && (item.sequence as number) >= 1 &&
        (item.reason === "budget" || item.reason === "oversize") && Number.isSafeInteger(item.originalTextBytes) && (item.originalTextBytes as number) >= 0) ||
      new Set(omissions.map((item) => isRecord(item) ? item.eventId : null)).size !== omissions.length ||
      omissions.some((item) => isRecord(item) && capturedEventIds.includes(item.eventId))) {
    throw new MemoryDraftError("DRAFT_CORRUPT", "草稿提炼覆盖范围无效");
  }
  const items = {} as Record<DraftCategory, DraftItem[]>;
  for (const category of CATEGORIES) {
    const list = value.items[category];
    if (!Array.isArray(list)) throw new MemoryDraftError("DRAFT_CORRUPT", "本地记忆条目列表无效");
    items[category] = list.map((item) => parseDraftItem(item));
  }
  const tests = value.tests.map(parseDraftTest);
  const provenance = value.provenance;
  if (typeof provenance.extractor !== "string" || typeof provenance.promptVersion !== "string" || typeof provenance.model !== "string" ||
      !(provenance.inputTokens === null || Number.isSafeInteger(provenance.inputTokens) && (provenance.inputTokens as number) >= 0) ||
      !(provenance.outputTokens === null || Number.isSafeInteger(provenance.outputTokens) && (provenance.outputTokens as number) >= 0)) {
    throw new MemoryDraftError("DRAFT_CORRUPT", "本地记忆来源信息无效");
  }
  const tombstones = value.tombstones as unknown[];
  if (!tombstones.every((item) => typeof item === "string" && item.length <= 100)) throw new MemoryDraftError("DRAFT_CORRUPT", "记忆删除标记无效");
  return {
    schemaVersion: 1, draftId: text(value.draftId), memoryId: text(value.memoryId), revision: value.revision as number,
    parentMemoryId: value.parentMemoryId as string | null, snapshotId: text(value.snapshotId),
    inputCoverage: { capturedEventIds: capturedEventIds as string[], omissions: omissions as MemoryDraftV1["inputCoverage"]["omissions"] },
    scope, inputDigest: text(value.inputDigest),
    status: value.status as MemoryDraftV1["status"], createdAt: text(value.createdAt), updatedAt: text(value.updatedAt),
    provenance: { extractor: text(provenance.extractor), promptVersion: text(provenance.promptVersion), model: text(provenance.model),
      inputTokens: provenance.inputTokens as number | null, outputTokens: provenance.outputTokens as number | null },
    items, tests, tombstones: tombstones as string[],
  };
}

function parseDraftItem(value: unknown): DraftItem {
  if (!isRecord(value) || !UUID.test(text(value.id)) && !HASH.test(text(value.id)) || typeof value.text !== "string" || value.text.length > 2000 ||
      !Array.isArray(value.evidenceRefs) || !value.evidenceRefs.every((item) => typeof item === "string" && UUID.test(item)) ||
      !["captured", "reported", "inferred"].includes(text(value.support)) || !["extracted", "human"].includes(text(value.origin)) ||
      !(value.candidateKey === null || HASH.test(text(value.candidateKey))) || !["active", "superseded", "uncertain"].includes(text(value.disposition))) {
    throw new MemoryDraftError("DRAFT_CORRUPT", "记忆条目无效");
  }
  return { id: text(value.id), text: text(value.text), evidenceRefs: value.evidenceRefs as string[], support: value.support as DraftItem["support"],
    origin: value.origin as DraftItem["origin"], candidateKey: value.candidateKey as string | null, disposition: value.disposition as DraftItem["disposition"] };
}
function parseDraftTest(value: unknown): DraftTest {
  if (!isRecord(value) || !UUID.test(text(value.id)) && !HASH.test(text(value.id)) || typeof value.command !== "string" || value.command.length > 1000 ||
      !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) || !Array.isArray(value.evidenceRefs) ||
      !value.evidenceRefs.every((item) => typeof item === "string" && UUID.test(item)) || !["captured", "reported"].includes(text(value.support)) ||
      !["extracted", "human"].includes(text(value.origin)) || !(value.candidateKey === null || HASH.test(text(value.candidateKey))) ||
      !["active", "superseded", "uncertain"].includes(text(value.disposition))) throw new MemoryDraftError("DRAFT_CORRUPT", "测试条目无效");
  return { id: text(value.id), command: text(value.command), exitCode: value.exitCode as number | null, evidenceRefs: value.evidenceRefs as string[],
    support: value.support as DraftTest["support"], origin: value.origin as DraftTest["origin"], candidateKey: value.candidateKey as string | null,
    disposition: value.disposition as DraftTest["disposition"] };
}

function parsePointer(value: unknown): CurrentPointer {
  if (!isRecord(value) || value.schemaVersion !== 1 || !UUID.test(text(value.draftId)) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    throw new MemoryDraftError("DRAFT_CORRUPT", "草稿索引无效");
  }
  return { schemaVersion: 1, draftId: text(value.draftId), revision: value.revision as number };
}

function assertSources(candidate: MemoryCandidateV1, input: PreparedExtractionInputV1, snapshot: ExtractionSnapshotV1): void {
  if (snapshot.snapshotId !== input.snapshotId || snapshot.captureDigest !== input.captureDigest ||
      snapshot.scope.projectId !== input.scope.projectId || snapshot.scope.taskId !== input.scope.taskId || snapshot.scope.sessionKey !== input.scope.sessionKey ||
      snapshot.scope.serverOrigin !== input.scope.serverOrigin || snapshot.scope.workspaceScope === "" || snapshot.scope.actorScope === "") {
    throw new MemoryDraftError("SCOPE_MISMATCH", "提炼结果与原会话快照范围不一致");
  }
  const known = new Set(input.events.map((event) => event.id));
  for (const category of CATEGORIES) for (const item of candidate[category]) if (item.evidenceRefs.some((id) => !known.has(id))) {
    throw new MemoryDraftError("INVALID_EVIDENCE", "模型候选包含无效出处");
  }
  for (const test of candidate.tests) if (test.evidenceRefs.some((id) => !known.has(id))) throw new MemoryDraftError("INVALID_EVIDENCE", "测试候选包含无效出处");
}
function assertSnapshotScope(draft: MemoryDraftV1, snapshot: ExtractionSnapshotV1): void {
  if (draft.snapshotId !== snapshot.snapshotId || !sameScope(draft.scope, snapshot.scope)) throw new MemoryDraftError("SCOPE_MISMATCH", "草稿与会话快照范围不一致");
}
function validateRefs(refs: string[], snapshot: ExtractionSnapshotV1, eventIds = new Set(snapshot.events.map((event) => event.id))): string[] {
  if (!Array.isArray(refs) || refs.length > 10 || !refs.every((id) => typeof id === "string" && eventIds.has(id))) throw new MemoryDraftError("INVALID_EVIDENCE", "人工填写的出处不属于当前会话");
  return unique(refs);
}
function validateManualTest(input: Extract<MemoryDraftPatch, { type: "add-test" }>, snapshot: ExtractionSnapshotV1): CandidateTest {
  const command = validateText(input.command, 1000);
  const exitCode = validateExitCode(input.exitCode);
  const refs = validateRefs(input.evidenceRefs, snapshot);
  const byId = new Map(snapshot.events.map((event) => [event.id, event]));
  const cited = refs.map((id) => byId.get(id)!);
  if (input.support === "captured") {
    const call = cited.find((event) => event.kind === "tool_call" && event.command === command);
    if (!call || !cited.some((event) => event.kind === "tool_result" && event.toolCallId === call.toolCallId && event.exitCode === exitCode && exitCode !== null)) {
      throw new MemoryDraftError("INVALID_EVIDENCE", "captured 测试必须有匹配的工具命令和退出码");
    }
  } else if (!cited.some((event) => event.kind === "user" || event.kind === "assistant")) {
    throw new MemoryDraftError("INVALID_EVIDENCE", "reported 测试必须有口头说明出处");
  }
  return { command, exitCode, evidenceRefs: refs, support: input.support };
}
function validateText(value: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new MemoryDraftError("INVALID_TEXT", `内容必须为 1–${max} 个字符`);
  return value.trim();
}
function validateExitCode(value: number | null): number | null {
  if (!(value === null || Number.isSafeInteger(value) && value >= -255 && value <= 255)) throw new MemoryDraftError("INVALID_TEST", "测试退出码无效");
  return value;
}
function toMemoryDocument(draft: MemoryDraftV1, snapshot: ExtractionSnapshotV1): MemoryDocumentV1 {
  const eventIds = new Set(snapshot.events.map((event) => event.id));
  const mapItem = (item: DraftItem): MemoryItemV1 => ({
    id: item.id, text: item.text, evidenceRefs: validateRefs(item.evidenceRefs, snapshot, eventIds),
    origin: item.origin, support: item.support, disposition: item.disposition,
  });
  return parseMemoryDocumentV1({
    schemaVersion: 1, id: draft.memoryId, sessionKey: draft.scope.sessionKey, projectId: draft.scope.projectId, taskId: draft.scope.taskId,
    parentMemoryId: draft.parentMemoryId, revision: draft.revision, inputDigest: draft.inputDigest,
    sourceCoverage: { fromSequence: snapshot.fromSequence, toSequence: snapshot.toSequence, gaps: snapshot.gapEventIds },
    code: { repositoryKeyHash: snapshot.repositoryKeyHash, headSha: snapshot.headSha, dirtyExcluded: snapshot.dirtyExcluded },
    goal: draft.items.goal.filter((item) => item.disposition !== "superseded").map(mapItem),
    constraints: draft.items.constraints.filter((item) => item.disposition !== "superseded").map(mapItem),
    completed: draft.items.completed.filter((item) => item.disposition !== "superseded").map(mapItem),
    remaining: draft.items.remaining.filter((item) => item.disposition !== "superseded").map(mapItem),
    decisions: draft.items.decisions.filter((item) => item.disposition !== "superseded").map(mapItem),
    rejectedApproaches: draft.items.rejectedApproaches.filter((item) => item.disposition !== "superseded").map(mapItem),
    blockers: draft.items.blockers.filter((item) => item.disposition !== "superseded").map(mapItem),
    nextActions: draft.items.nextActions.filter((item) => item.disposition !== "superseded").map(mapItem),
    tests: draft.tests.filter((item) => item.disposition !== "superseded").map((item) => ({
      command: item.command, exitCode: item.exitCode, evidenceRefs: validateRefs(item.evidenceRefs, snapshot, eventIds), support: item.support,
    })),
    provenance: {
      extractor: draft.provenance.extractor, promptVersion: draft.provenance.promptVersion, model: draft.provenance.model,
      createdAt: draft.createdAt, editedBy: "local-user", usage: { inputTokens: draft.provenance.inputTokens, outputTokens: draft.provenance.outputTokens },
    },
  }, eventIds);
}
function sameScope(a: MemoryScope, b: MemoryScope): boolean { return stableStringify(parseScope(a)) === stableStringify(parseScope(b)); }
function digest(value: unknown): string { return createHash("sha256").update(stableStringify(value)).digest("hex"); }
function normalizeText(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function assertUuid(value: string): void { if (!UUID.test(value)) throw new MemoryDraftError("INVALID_ID", "记忆草稿标识无效"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function isAlreadyExists(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST"; }
function isRunningProcess(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return !!error && typeof error === "object" && "code" in error && error.code === "EPERM"; } }

async function writeImmutable(destination: string, content: string): Promise<void> {
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await link(temporary, destination);
  } catch {
    throw new MemoryDraftError("REVISION_EXISTS", "该草稿版本已存在或无法写入；不会覆盖历史版本");
  } finally { await unlink(temporary).catch(() => undefined); }
}
