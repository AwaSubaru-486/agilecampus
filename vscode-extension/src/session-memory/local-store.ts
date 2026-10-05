import { createHash, randomUUID } from "node:crypto";
import { lstat, link, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parseNormalizedEventV1, SESSION_MEMORY_MAX_EVENTS } from "../../../shared/session-memory/schema";
import type { NormalizedEventV1 } from "../../../shared/session-memory/types";
import { GitRefLockStore } from "../attempts/git-ref-lock";

export type SessionProvider = "codex" | "claude";

export type LocalSessionBinding = {
  schemaVersion: 1;
  sessionKey: string;
  provider: SessionProvider;
  /** Provider-native ID is local-only and must never be included in a shared package. */
  providerSessionId: string;
  workspacePath: string;
  projectId: string;
  taskId: string;
  boundAt: string;
  recording: boolean;
};

export type NewLocalEvent = Pick<NormalizedEventV1, "kind" | "text" | "sourceRef"> &
  Partial<Pick<NormalizedEventV1, "timestamp" | "toolCallId" | "command" | "exitCode" | "paths">>;

export type LocalSessionEventPage = {
  events: NormalizedEventV1[];
  total: number;
  hasOlder: boolean;
  nextBeforeSequence: number | null;
};

export type LocalSessionSummary = Omit<LocalSessionBinding, "providerSessionId"> & {
  eventCount: number;
  latestSequence: number;
  lastSavedAt: string | null;
  hasGaps: boolean;
  captureFailures: LocalCaptureFailure[];
};

export type LocalCaptureFailure = { occurredAt: string; detail: string; sourceRef?: string | null };
export type LocalHookAlert = { id: string; occurredAt: string; detail: string };
export type FrozenLocalCapture = {
  binding: LocalSessionBinding;
  events: NormalizedEventV1[];
  failures: LocalCaptureFailure[];
  capturedAt: string;
};

type BindingIndex = { schemaVersion: 1; bindings: LocalSessionBinding[] };
type EventCursor = { schemaVersion: 1; sessionKey: string; nextSequence: number; hasGaps: boolean };
type SourceRefIndex = { schemaVersion: 1; sessionKey: string; sourceRef: string; sequence: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 256 * 1024;
const MAX_SOURCE_REF_LENGTH = 2048;
const MAX_FROZEN_CAPTURE_BYTES = 10 * 1024 * 1024;

export class LocalSessionStoreError extends Error {
  constructor(message: string) { super(message); this.name = "LocalSessionStoreError"; }
}

/**
 * Local-only session bindings and an append-only normalized event journal.
 * This store has no network dependencies; provider hooks must call it only after
 * an explicit user binding has been made for the current workspace and task.
 */
export class LocalSessionStore {
  private readonly coordination: GitRefLockStore;

  constructor(private readonly storageRoot: string, private readonly now: () => Date = () => new Date()) {
    this.coordination = new GitRefLockStore(storageRoot);
  }

  async bind(input: {
    provider: SessionProvider;
    providerSessionId: string;
    workspacePath: string;
    projectId: string;
    taskId: string;
  }): Promise<LocalSessionBinding> {
    const providerSessionId = input.providerSessionId.trim();
    const projectId = input.projectId.trim();
    const taskId = input.taskId.trim();
    if ((input.provider !== "codex" && input.provider !== "claude") || !providerSessionId || providerSessionId.length > 512 || !projectId || !taskId) {
      throw new LocalSessionStoreError("会话绑定信息无效");
    }
    const workspacePath = await canonicalWorkspace(input.workspacePath);

    return this.withLock(async () => {
      const index = await this.readBindings();
      const existing = index.bindings.find((item) => item.provider === input.provider && item.providerSessionId === providerSessionId);
      if (existing) {
        if (existing.recording && existing.workspacePath === workspacePath && existing.projectId === projectId && existing.taskId === taskId) {
          await this.ensureSessionStorage(existing.sessionKey);
          return existing;
        }
        throw new LocalSessionStoreError("该原生会话已有绑定记录；解除旧绑定后不能复用同一会话，请选择未绑定的会话");
      }

      const binding: LocalSessionBinding = {
        schemaVersion: 1,
        sessionKey: randomUUID(),
        provider: input.provider,
        providerSessionId,
        workspacePath,
        projectId,
        taskId,
        boundAt: this.now().toISOString(),
        recording: true,
      };
      index.bindings.push(binding);
      await this.writeJsonAtomic(this.bindingsPath(), index);
      await this.ensureSessionStorage(binding.sessionKey);
      return binding;
    });
  }

  async list(workspacePath: string, projectId?: string, taskId?: string): Promise<LocalSessionBinding[]> {
    const canonical = await canonicalWorkspace(workspacePath);
    const index = await this.readBindings();
    return index.bindings.filter((item) => item.workspacePath === canonical &&
      (projectId === undefined || item.projectId === projectId) && (taskId === undefined || item.taskId === taskId));
  }

  async findActiveBinding(provider: SessionProvider, providerSessionId: string, workingDirectory: string): Promise<LocalSessionBinding | null> {
    if (!providerSessionId || providerSessionId.length > 512) return null;
    const cwd = await canonicalWorkspace(workingDirectory);
    const index = await this.readBindings();
    return index.bindings.find((item) => item.recording && item.provider === provider &&
      item.providerSessionId === providerSessionId && isWithinWorkspace(item.workspacePath, cwd)) ?? null;
  }

  async summary(sessionKey: string): Promise<LocalSessionSummary> {
    if (!UUID.test(sessionKey)) throw new LocalSessionStoreError("会话标识无效");
    return this.withLock(async () => {
      const index = await this.readBindings();
      const binding = index.bindings.find((item) => item.sessionKey === sessionKey);
      if (!binding) throw new LocalSessionStoreError("找不到本地会话绑定");
      const cursor = await this.readCursor(sessionKey);
      const eventCount = cursor.nextSequence - 1;
      await this.assertContiguousEventFiles(sessionKey, eventCount);
      let lastSavedAt: string | null = null;
      if (eventCount > 0) {
        try { lastSavedAt = (await stat(this.eventPath(sessionKey, eventCount))).mtime.toISOString(); }
        catch { throw new LocalSessionStoreError("最新本地记录无法读取；为避免误报，已停止显示记录状态"); }
      }
      const { providerSessionId: _localOnlyId, ...publicBinding } = binding;
      return {
        ...publicBinding,
        eventCount,
        latestSequence: eventCount,
        lastSavedAt,
        hasGaps: cursor.hasGaps,
        captureFailures: await this.readCaptureFailures(sessionKey),
      };
    });
  }

  /** Persist each failed source separately so recovery of one event cannot hide another missing event. */
  async recordCaptureFailure(sessionKey: string, detail: string, sourceRef?: string): Promise<void> {
    if (!UUID.test(sessionKey)) throw new LocalSessionStoreError("会话标识无效");
    const normalized = typeof detail === "string" && detail.trim()
      ? detail.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1200)
      : "本机事件写入失败";
    const id = sourceRef ? createHash("sha256").update(sourceRef).digest("hex") : randomUUID();
    const file = this.captureFailurePath(sessionKey, id);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, sessionKey, occurredAt: this.now().toISOString(), detail: normalized, sourceRef: sourceRef ?? null }), { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new LocalSessionStoreError(error instanceof Error ? error.message : "无法保存 Hook 失败状态");
    }
  }

  async clearCaptureFailure(sessionKey: string, recoveredSourceRef: string): Promise<void> {
    if (!UUID.test(sessionKey) || !recoveredSourceRef) return;
    const file = this.captureFailurePath(sessionKey, createHash("sha256").update(recoveredSourceRef).digest("hex"));
    try {
      const failure = await this.readCaptureFailureFile(file, sessionKey);
      if (failure?.sourceRef === recoveredSourceRef) await unlink(file);
    } catch (error) {
      if (isMissing(error)) return;
      throw new LocalSessionStoreError("无法清除已恢复的本机会话采集错误状态");
    }
    // Read and clear the pre-upgrade single-failure marker, if present.
    const legacy = this.legacyCaptureFailurePath(sessionKey);
    try {
      const failure = await this.readCaptureFailureFile(legacy, sessionKey);
      if (failure?.sourceRef === recoveredSourceRef) await unlink(legacy);
    } catch (error) {
      if (!isMissing(error)) throw new LocalSessionStoreError("无法清除已恢复的本机会话采集错误状态");
    }
  }

  async recordHookAlert(detail: string): Promise<LocalHookAlert> {
    const alert: LocalHookAlert = {
      id: randomUUID(), occurredAt: this.now().toISOString(),
      detail: detail.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1200) || "Codex Hook 无法记录输入",
    };
    const file = this.hookAlertPath(alert.id);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, ...alert }), { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
      return alert;
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new LocalSessionStoreError(error instanceof Error ? error.message : "无法保存本机 Hook 故障提示");
    }
  }

  async listHookAlerts(): Promise<LocalHookAlert[]> {
    const directory = this.hookAlertsPath();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (isMissing(error)) return []; throw new LocalSessionStoreError("无法读取本机 Hook 故障提示"); }
    const alerts: LocalHookAlert[] = [];
    for (const entry of entries) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new LocalSessionStoreError("本机 Hook 故障提示文件无效");
      const parsed: unknown = JSON.parse(await readFile(path.join(directory, entry.name), "utf8"));
      if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
          typeof (parsed as { id?: unknown }).id !== "string" || `${(parsed as { id: string }).id}.json` !== entry.name ||
          typeof (parsed as { occurredAt?: unknown }).occurredAt !== "string" || !Number.isFinite(Date.parse((parsed as { occurredAt: string }).occurredAt)) ||
          typeof (parsed as { detail?: unknown }).detail !== "string" || (parsed as { detail: string }).detail.length > 1200) {
        throw new LocalSessionStoreError("本机 Hook 故障提示数据无效");
      }
      alerts.push({ id: (parsed as { id: string }).id, occurredAt: (parsed as { occurredAt: string }).occurredAt, detail: (parsed as { detail: string }).detail });
    }
    return alerts.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  async dismissHookAlert(id: string): Promise<void> {
    if (!UUID.test(id)) throw new LocalSessionStoreError("Hook 故障提示标识无效");
    const file = this.hookAlertPath(id);
    try {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new LocalSessionStoreError("Hook 故障提示文件无效");
      await unlink(file);
    } catch (error) { if (!isMissing(error)) throw error; }
  }

  async unbind(sessionKey: string): Promise<void> {
    if (!UUID.test(sessionKey)) throw new LocalSessionStoreError("会话标识无效");
    await this.withLock(async () => {
      const index = await this.readBindings();
      const binding = index.bindings.find((item) => item.sessionKey === sessionKey);
      if (!binding) throw new LocalSessionStoreError("找不到本地会话绑定");
      if (!binding.recording) return;
      binding.recording = false;
      await this.writeJsonAtomic(this.bindingsPath(), index);
    });
  }

  async append(sessionKey: string, input: NewLocalEvent): Promise<{ event: NormalizedEventV1; duplicate: boolean }> {
    if (!UUID.test(sessionKey)) throw new LocalSessionStoreError("会话标识无效");
    if (!input || typeof input !== "object" || typeof input.text !== "string" || input.text.length > MAX_TEXT_LENGTH ||
        typeof input.sourceRef !== "string" || !input.sourceRef.trim() || input.sourceRef.length > MAX_SOURCE_REF_LENGTH) {
      throw new LocalSessionStoreError("会话事件无效或超出本地记录上限");
    }

    return this.withLock(async () => {
      const index = await this.readBindings();
      const binding = index.bindings.find((item) => item.sessionKey === sessionKey);
      if (!binding || !binding.recording) throw new LocalSessionStoreError("会话未关联或已停止记录");
      let cursor = await this.readCursor(sessionKey);
      const existing = await this.readEventBySourceRef(sessionKey, input.sourceRef);
      if (existing) {
        if (!sameEventPayload(existing, input)) throw new LocalSessionStoreError("同一来源引用对应了不同事件内容，拒绝覆盖已有记录");
        return { event: existing, duplicate: true };
      }
      // Recover the one possible crash window: event is durable, cursor is not.
      const interruptedWrite = await this.readEventAt(sessionKey, cursor.nextSequence);
      if (interruptedWrite) {
        cursor = await this.rebuildCursor(sessionKey);
        const recovered = await this.readEventBySourceRef(sessionKey, input.sourceRef);
        if (recovered) {
          if (!sameEventPayload(recovered, input)) throw new LocalSessionStoreError("同一来源引用对应了不同事件内容，拒绝覆盖已有记录");
          return { event: recovered, duplicate: true };
        }
      }
      if (cursor.nextSequence > SESSION_MEMORY_MAX_EVENTS) throw new LocalSessionStoreError("本地事件数已达上限；保留现有记录并标记采集缺口");

      const event = parseNormalizedEventV1({
        schemaVersion: 1,
        id: randomUUID(),
        sessionKey,
        sequence: cursor.nextSequence,
        timestamp: input.timestamp === undefined ? null : input.timestamp,
        kind: input.kind,
        text: input.text,
        ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {}),
        ...(input.command !== undefined ? { command: input.command } : {}),
        ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
        ...(input.paths !== undefined ? { paths: input.paths } : {}),
        sourceRef: input.sourceRef,
      });
      await this.writeImmutableEvent(event);
      await this.writeJsonAtomic(this.sourceRefPath(sessionKey, input.sourceRef), {
        schemaVersion: 1, sessionKey, sourceRef: input.sourceRef, sequence: event.sequence,
      } satisfies SourceRefIndex);
      if (event.kind === "gap") cursor.hasGaps = true;
      cursor.nextSequence += 1;
      await this.writeJsonAtomic(this.cursorPath(sessionKey), cursor);
      return { event, duplicate: false };
    });
  }

  async readEvents(sessionKey: string): Promise<NormalizedEventV1[]> {
    if (!UUID.test(sessionKey)) throw new LocalSessionStoreError("会话标识无效");
    return this.withLock(async () => {
      const index = await this.readBindings();
      if (!index.bindings.some((item) => item.sessionKey === sessionKey)) throw new LocalSessionStoreError("找不到本地会话绑定");
      const cursor = await this.readCursor(sessionKey);
      const events = await this.readEventsFromDisk(sessionKey);
      if (events.length !== cursor.nextSequence - 1) throw new LocalSessionStoreError("会话记录与采集游标不一致；记录可能有缺口");
      return events;
    });
  }

  /** Freeze one contiguous event prefix and its failure markers under the journal lock. */
  async freezeCapture(sessionKey: string): Promise<FrozenLocalCapture> {
    if (!UUID.test(sessionKey)) throw new LocalSessionStoreError("会话标识无效");
    return this.withLock(async () => {
      const index = await this.readBindings();
      const binding = index.bindings.find((item) => item.sessionKey === sessionKey);
      if (!binding) throw new LocalSessionStoreError("找不到本地会话绑定");
      const cursor = await this.readCursor(sessionKey);
      const count = cursor.nextSequence - 1;
      if (count < 1) throw new LocalSessionStoreError("EMPTY_CAPTURE");
      if (count > SESSION_MEMORY_MAX_EVENTS) throw new LocalSessionStoreError("会话记录超过冻结上限");
      await this.assertContiguousEventFiles(sessionKey, count);
      const entries = await readdir(this.eventsPath(sessionKey), { withFileTypes: true });
      let byteCount = 0;
      for (const entry of entries) {
        if (!/^\d{12}\.json$/.test(entry.name)) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) throw new LocalSessionStoreError("会话事件文件不是普通文件");
        const metadata = await lstat(path.join(this.eventsPath(sessionKey), entry.name));
        byteCount += metadata.size;
        if (byteCount > MAX_FROZEN_CAPTURE_BYTES) throw new LocalSessionStoreError("SNAPSHOT_TOO_LARGE");
      }
      const events = await this.readEventsFromDisk(sessionKey);
      if (events.length !== count || events.some((event, position) => event.sequence !== position + 1 || event.sessionKey !== sessionKey)) {
        throw new LocalSessionStoreError("会话事件序号或范围无效");
      }
      return {
        binding: { ...binding },
        events,
        failures: await this.readCaptureFailures(sessionKey),
        capturedAt: this.now().toISOString(),
      };
    });
  }

  async readEventsPage(sessionKey: string, options: { beforeSequence?: number; limit?: number } = {}): Promise<LocalSessionEventPage> {
    if (!UUID.test(sessionKey)) throw new LocalSessionStoreError("会话标识无效");
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new LocalSessionStoreError("每页记录数必须在 1 到 100 之间");
    if (options.beforeSequence !== undefined && (!Number.isSafeInteger(options.beforeSequence) || options.beforeSequence < 1)) {
      throw new LocalSessionStoreError("记录分页位置无效");
    }
    return this.withLock(async () => {
      const index = await this.readBindings();
      if (!index.bindings.some((item) => item.sessionKey === sessionKey)) throw new LocalSessionStoreError("找不到本地会话绑定");
      const cursor = await this.readCursor(sessionKey);
      const total = cursor.nextSequence - 1;
      await this.assertContiguousEventFiles(sessionKey, total);
      const before = Math.min(options.beforeSequence ?? total + 1, total + 1);
      const first = Math.max(1, before - limit);
      const events: NormalizedEventV1[] = [];
      for (let sequence = first; sequence < before; sequence += 1) {
        const event = await this.readEventAt(sessionKey, sequence);
        if (!event) throw new LocalSessionStoreError("会话记录与采集游标不一致；记录可能有缺口");
        events.push(event);
      }
      return { events, total, hasOlder: first > 1, nextBeforeSequence: first > 1 ? first : null };
    });
  }

  private async readBindings(): Promise<BindingIndex> {
    const file = this.bindingsPath();
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!isBindingIndex(parsed)) throw new Error("invalid index");
      return parsed;
    } catch (error) {
      if (isMissing(error)) return { schemaVersion: 1, bindings: [] };
      throw new LocalSessionStoreError("本地会话绑定索引损坏；为避免覆盖，已停止操作");
    }
  }

  private async ensureSessionStorage(sessionKey: string): Promise<void> {
    await mkdir(this.eventsPath(sessionKey), { recursive: true, mode: 0o700 });
    // The binding index is persisted before session storage. Rebuilding here
    // makes a retry complete initialization after a crash at that boundary,
    // while preserving any event files that were already committed.
    await this.readCursor(sessionKey);
  }

  private async readEventsFromDisk(sessionKey: string): Promise<NormalizedEventV1[]> {
    const directory = this.eventsPath(sessionKey);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const files = entries.filter((entry) => /^\d{12}\.json$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
      const events: NormalizedEventV1[] = [];
      const sourceRefs = new Set<string>();
      for (const entry of files) {
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("invalid event file");
        const sequence = events.length + 1;
        if (entry.name !== eventFilename(sequence)) throw new Error("event sequence gap");
        const parsed: unknown = JSON.parse(await readFile(path.join(directory, entry.name), "utf8"));
        const event = parseNormalizedEventV1(parsed);
        if (event.sessionKey !== sessionKey || event.sequence !== sequence || sourceRefs.has(event.sourceRef)) throw new Error("event identity mismatch");
        sourceRefs.add(event.sourceRef);
        events.push(event);
      }
      if (events.length > SESSION_MEMORY_MAX_EVENTS) throw new Error("event limit exceeded");
      return events;
    } catch (error) {
      if (isMissing(error)) throw new LocalSessionStoreError("本地会话事件目录缺失；不能将其解释为空会话");
      throw new LocalSessionStoreError("本地会话事件日志损坏；为避免丢失记录，已停止操作");
    }
  }

  private async assertContiguousEventFiles(sessionKey: string, expectedCount: number): Promise<void> {
    try {
      const entries = await readdir(this.eventsPath(sessionKey), { withFileTypes: true });
      const files = entries.filter((entry) => /^\d{12}\.json$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
      if (files.length !== expectedCount || files.some((entry, index) => !entry.isFile() || entry.isSymbolicLink() || entry.name !== eventFilename(index + 1))) {
        throw new Error("journal gap");
      }
    } catch (error) {
      if (isMissing(error)) throw new LocalSessionStoreError("本地会话事件目录缺失；不能将其解释为空会话");
      if (error instanceof LocalSessionStoreError) throw error;
      throw new LocalSessionStoreError("会话记录序号存在缺口；为避免展示不完整历史，已停止读取");
    }
  }

  private async readCursor(sessionKey: string): Promise<EventCursor> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.cursorPath(sessionKey), "utf8"));
      if (isEventCursor(parsed, sessionKey)) {
        const previous = parsed.nextSequence > 1 ? await this.readEventAt(sessionKey, parsed.nextSequence - 1) : undefined;
        const pending = await this.readEventAt(sessionKey, parsed.nextSequence);
        if (parsed.nextSequence > 1 && !previous) {
          throw new LocalSessionStoreError("采集游标指向的已提交事件缺失；停止记录以保留缺口证据");
        }
        if (parsed.nextSequence === 1 || previous?.sequence === parsed.nextSequence - 1) {
          if (pending) return this.rebuildCursor(sessionKey);
          if (await this.eventRecordCount(sessionKey) !== parsed.nextSequence - 1) {
            throw new LocalSessionStoreError("事件序号存在缺口；停止记录以保留缺口证据");
          }
          if (await this.sourceRefIndexCount(sessionKey) === parsed.nextSequence - 1) return parsed;
          return this.rebuildCursor(sessionKey);
        }
      }
    } catch (error) {
      if (error instanceof LocalSessionStoreError && (error.message.includes("已提交事件缺失") || error.message.includes("事件序号存在缺口"))) throw error;
      /* Rebuild derived cursor/index state from immutable event files below. */
    }
    return this.rebuildCursor(sessionKey);
  }

  private async rebuildCursor(sessionKey: string): Promise<EventCursor> {
    const events = await this.readEventsFromDisk(sessionKey);
    const recovered: EventCursor = { schemaVersion: 1, sessionKey, nextSequence: events.length + 1, hasGaps: events.some((event) => event.kind === "gap") };
    const validIndexNames = new Set<string>();
    for (const event of events) {
      const sourceRefPath = this.sourceRefPath(sessionKey, event.sourceRef);
      validIndexNames.add(path.basename(sourceRefPath));
      await this.writeJsonAtomic(sourceRefPath, {
        schemaVersion: 1, sessionKey, sourceRef: event.sourceRef, sequence: event.sequence,
      } satisfies SourceRefIndex);
    }
    const indexDirectory = this.sourceRefsPath(sessionKey);
    try {
      for (const entry of await readdir(indexDirectory, { withFileTypes: true })) {
        if (/^[0-9a-f]{64}\.json$/i.test(entry.name) && !validIndexNames.has(entry.name)) {
          await rm(path.join(indexDirectory, entry.name), { force: true });
        }
      }
    } catch (error) { if (!isMissing(error)) throw new LocalSessionStoreError("无法修复本地事件幂等索引"); }
    await this.writeJsonAtomic(this.cursorPath(sessionKey), recovered);
    return recovered;
  }

  private async sourceRefIndexCount(sessionKey: string): Promise<number> {
    try {
      return (await readdir(this.sourceRefsPath(sessionKey), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^[0-9a-f]{64}\.json$/i.test(entry.name)).length;
    } catch (error) {
      if (isMissing(error)) return 0;
      throw new LocalSessionStoreError("无法读取本地事件幂等索引");
    }
  }

  private async readCaptureFailures(sessionKey: string): Promise<LocalCaptureFailure[]> {
    const failures: LocalCaptureFailure[] = [];
    const directory = this.captureFailuresPath(sessionKey);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!/^[0-9a-f-]{36,64}\.json$/i.test(entry.name)) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("invalid capture failure file");
        const failure = await this.readCaptureFailureFile(path.join(directory, entry.name), sessionKey);
        if (failure) failures.push(failure);
      }
    } catch (error) { if (!isMissing(error)) throw new LocalSessionStoreError("本机会话采集故障状态损坏；为避免误报，已停止显示状态"); }
    const legacy = await this.readCaptureFailureFile(this.legacyCaptureFailurePath(sessionKey), sessionKey);
    if (legacy) failures.push(legacy);
    return failures.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  private async readCaptureFailureFile(file: string, sessionKey: string): Promise<LocalCaptureFailure | null> {
    try {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("invalid failure status file");
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
          (parsed as { sessionKey?: unknown }).sessionKey !== sessionKey || typeof (parsed as { occurredAt?: unknown }).occurredAt !== "string" ||
          !Number.isFinite(Date.parse((parsed as { occurredAt: string }).occurredAt)) || typeof (parsed as { detail?: unknown }).detail !== "string" ||
          (parsed as { detail: string }).detail.length > 1200 ||
          ((parsed as { sourceRef?: unknown }).sourceRef !== undefined && (parsed as { sourceRef?: unknown }).sourceRef !== null &&
            (typeof (parsed as { sourceRef?: unknown }).sourceRef !== "string" || (parsed as { sourceRef: string }).sourceRef.length > MAX_SOURCE_REF_LENGTH))) {
        throw new Error("invalid failure status");
      }
      return {
        occurredAt: (parsed as { occurredAt: string }).occurredAt,
        detail: (parsed as { detail: string }).detail,
        sourceRef: typeof (parsed as { sourceRef?: unknown }).sourceRef === "string" ? (parsed as { sourceRef: string }).sourceRef : null,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw new LocalSessionStoreError("本机会话采集故障状态损坏；为避免误报，已停止显示状态");
    }
  }

  private async eventRecordCount(sessionKey: string): Promise<number> {
    try {
      return (await readdir(this.eventsPath(sessionKey), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^\d{12}\.json$/.test(entry.name)).length;
    } catch (error) {
      if (isMissing(error)) throw new LocalSessionStoreError("本地会话事件目录缺失；不能将其解释为空会话");
      throw new LocalSessionStoreError("无法校验本地会话事件数量");
    }
  }

  private async readEventBySourceRef(sessionKey: string, sourceRef: string): Promise<NormalizedEventV1 | undefined> {
    let index: unknown;
    try { index = JSON.parse(await readFile(this.sourceRefPath(sessionKey, sourceRef), "utf8")); }
    catch (error) { if (isMissing(error)) return undefined; throw new LocalSessionStoreError("本地事件幂等索引损坏"); }
    if (!isSourceRefIndex(index, sessionKey) || index.sourceRef !== sourceRef) throw new LocalSessionStoreError("本地事件幂等索引与来源不匹配");
    const event = await this.readEventAt(sessionKey, index.sequence);
    if (!event || event.sourceRef !== sourceRef) throw new LocalSessionStoreError("本地事件幂等索引指向无效记录");
    return event;
  }

  private async readEventAt(sessionKey: string, sequence: number): Promise<NormalizedEventV1 | undefined> {
    const file = this.eventPath(sessionKey, sequence);
    try {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not a regular file");
      const event = parseNormalizedEventV1(JSON.parse(await readFile(file, "utf8")));
      if (event.sessionKey !== sessionKey || event.sequence !== sequence) throw new Error("event identity mismatch");
      return event;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw new LocalSessionStoreError("本地会话事件记录损坏；为避免覆盖，已停止写入");
    }
  }

  private async writeImmutableEvent(event: NormalizedEventV1): Promise<void> {
    const destination = this.eventPath(event.sessionKey, event.sequence);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, JSON.stringify(event), { flag: "wx", mode: 0o600 });
      await link(temporary, destination);
    } catch {
      throw new LocalSessionStoreError("事件记录已存在或写入失败；不会覆盖已保存事件");
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new LocalSessionStoreError("本地会话记录写入失败；已有记录未被主动删除");
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    const canonicalStorageRoot = await realpath(this.storageRoot);
    const deadline = Date.now() + 5000;
    let pause = 10;
    while (Date.now() < deadline) {
      let lock;
      try {
        lock = await this.coordination.tryAcquire(`session-memory:${canonicalStorageRoot}`, {
          kind: "session-memory-write", hostPid: process.pid,
        }, (record) => !isRunningProcess(record.hostPid));
      } catch (error) {
        throw new LocalSessionStoreError(error instanceof Error ? error.message : "无法创建本地会话写入锁");
      }
      if (lock) {
        try { return await operation(); }
        finally { await lock.release(); }
      }
      await delay(pause);
      pause = Math.min(100, pause + 10);
    }
    throw new LocalSessionStoreError("另一个会话记录任务正在写入；请稍后重试");
  }

  private bindingsPath(): string { return path.join(this.storageRoot, "session-memory", "bindings.json"); }
  private eventsPath(sessionKey: string): string { return path.join(this.storageRoot, "session-memory", "sessions", sessionKey, "events"); }
  private eventPath(sessionKey: string, sequence: number): string { return path.join(this.eventsPath(sessionKey), eventFilename(sequence)); }
  private sourceRefsPath(sessionKey: string): string { return path.join(this.storageRoot, "session-memory", "sessions", sessionKey, "source-refs"); }
  private sourceRefPath(sessionKey: string, sourceRef: string): string { return path.join(this.sourceRefsPath(sessionKey), `${sourceRefKey(sourceRef)}.json`); }
  private cursorPath(sessionKey: string): string { return path.join(this.storageRoot, "session-memory", "sessions", sessionKey, "cursor.json"); }
  private captureFailuresPath(sessionKey: string): string { return path.join(this.storageRoot, "session-memory", "sessions", sessionKey, "capture-failures"); }
  private captureFailurePath(sessionKey: string, id: string): string { return path.join(this.captureFailuresPath(sessionKey), `${id}.json`); }
  private legacyCaptureFailurePath(sessionKey: string): string { return path.join(this.storageRoot, "session-memory", "sessions", sessionKey, "capture-failure.json"); }
  private hookAlertsPath(): string { return path.join(this.storageRoot, "session-memory", "hook-alerts"); }
  private hookAlertPath(id: string): string { return path.join(this.hookAlertsPath(), `${id}.json`); }
}

function isBindingIndex(value: unknown): value is BindingIndex {
  if (!value || typeof value !== "object" || (value as BindingIndex).schemaVersion !== 1 || !Array.isArray((value as BindingIndex).bindings)) return false;
  return (value as BindingIndex).bindings.every((item) => !!item && typeof item === "object" &&
    (item.provider === "codex" || item.provider === "claude") && UUID.test(item.sessionKey) &&
    typeof item.providerSessionId === "string" && typeof item.workspacePath === "string" &&
    typeof item.projectId === "string" && typeof item.taskId === "string" && typeof item.boundAt === "string" &&
    typeof item.recording === "boolean");
}

function isEventCursor(value: unknown, sessionKey: string): value is EventCursor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as EventCursor;
  return candidate.schemaVersion === 1 && candidate.sessionKey === sessionKey && Number.isSafeInteger(candidate.nextSequence) &&
    candidate.nextSequence >= 1 && typeof candidate.hasGaps === "boolean";
}

function isSourceRefIndex(value: unknown, sessionKey: string): value is SourceRefIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as SourceRefIndex;
  return candidate.schemaVersion === 1 && candidate.sessionKey === sessionKey && typeof candidate.sourceRef === "string" &&
    Number.isSafeInteger(candidate.sequence) && candidate.sequence >= 1;
}

function sameEventPayload(event: NormalizedEventV1, input: NewLocalEvent): boolean {
  return event.kind === input.kind && event.text === input.text && event.sourceRef === input.sourceRef &&
    (input.timestamp === undefined || event.timestamp === input.timestamp) &&
    event.toolCallId === input.toolCallId && event.command === input.command && event.exitCode === input.exitCode &&
    JSON.stringify(event.paths ?? null) === JSON.stringify(input.paths ?? null);
}

async function canonicalWorkspace(workspacePath: string): Promise<string> {
  if (typeof workspacePath !== "string" || !workspacePath.trim()) throw new LocalSessionStoreError("工作区路径无效");
  try {
    const canonical = await realpath(workspacePath);
    if (!(await stat(canonical)).isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch { throw new LocalSessionStoreError("无法确认会话所属工作区；只允许绑定已打开的本地目录"); }
}

function isWithinWorkspace(workspacePath: string, candidatePath: string): boolean {
  const relative = path.relative(workspacePath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isMissing(error: unknown): boolean { return hasCode(error, "ENOENT"); }
function isPermissionError(error: unknown): boolean { return hasCode(error, "EPERM"); }
function isRunningProcess(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return isPermissionError(error); }
}
function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function eventFilename(sequence: number): string { return `${String(sequence).padStart(12, "0")}.json`; }
function sourceRefKey(sourceRef: string): string { return createHash("sha256").update(sourceRef).digest("hex"); }
