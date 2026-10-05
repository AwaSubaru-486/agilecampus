import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSessionStore, LocalSessionStoreError } from "../src/session-memory/local-store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-session-memory-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const store = new LocalSessionStore(path.join(root, "extension-storage"), () => new Date("2026-10-02T12:00:00.000Z"));
  const binding = await store.bind({
    provider: "codex", providerSessionId: "native-session-1", workspacePath: workspace,
    projectId: "project-1", taskId: "task-1",
  });
  return { root, workspace, store, binding };
}

describe("local session memory store", () => {
  it("binds only the canonical workspace and keeps the provider ID in local storage", async () => {
    const { root, workspace, store, binding } = await fixture();
    expect(binding.workspacePath).toBe(await realpath(workspace));
    expect(binding.recording).toBe(true);
    expect(await store.list(workspace, "project-1", "task-1")).toEqual([binding]);
    const onDisk = await readFile(path.join(root, "extension-storage", "session-memory", "bindings.json"), "utf8");
    expect(onDisk).toContain("native-session-1");
    expect(onDisk).not.toContain("transcript");
  });

  it("rejects binding the same native session to another task and unbind preserves history but stops writes", async () => {
    const { workspace, store, binding } = await fixture();
    await expect(store.bind({ provider: "codex", providerSessionId: "native-session-1", workspacePath: workspace, projectId: "project-1", taskId: "task-2" }))
      .rejects.toBeInstanceOf(LocalSessionStoreError);
    await store.append(binding.sessionKey, { kind: "user", text: "keep this local record", sourceRef: "prompt:1" });
    await store.unbind(binding.sessionKey);
    await expect(store.append(binding.sessionKey, { kind: "assistant", text: "must not be recorded", sourceRef: "message:2" }))
      .rejects.toThrow("已停止记录");
    expect((await store.readEvents(binding.sessionKey)).map((event) => event.text)).toEqual(["keep this local record"]);
    expect((await store.list(workspace))[0].recording).toBe(false);
  });

  it("assigns durable ordered sequences, deduplicates retries, and preserves repeated utterances with distinct source refs", async () => {
    const { store, binding } = await fixture();
    const first = { kind: "user" as const, text: "run tests", sourceRef: "codex:prompt:1" };
    const a = await store.append(binding.sessionKey, first);
    const retry = await store.append(binding.sessionKey, first);
    const repeated = await store.append(binding.sessionKey, { ...first, sourceRef: "codex:prompt:2" });
    expect(a.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.event.id).toBe(a.event.id);
    expect(repeated.duplicate).toBe(false);
    expect((await store.readEvents(binding.sessionKey)).map(({ sequence, text }) => [sequence, text])).toEqual([[1, "run tests"], [2, "run tests"]]);
  });

  it("reads the newest 50 events first and pages backward without loading the whole journal", async () => {
    const { store, binding } = await fixture();
    for (let index = 1; index <= 57; index += 1) {
      await store.append(binding.sessionKey, { kind: "assistant", text: `event ${index}`, sourceRef: `event:${index}` });
    }
    const latest = await store.readEventsPage(binding.sessionKey);
    expect(latest.events.map((event) => event.sequence)).toEqual(Array.from({ length: 50 }, (_, index) => index + 8));
    expect(latest).toMatchObject({ total: 57, hasOlder: true, nextBeforeSequence: 8 });
    const older = await store.readEventsPage(binding.sessionKey, { beforeSequence: latest.nextBeforeSequence ?? undefined });
    expect(older.events.map((event) => event.sequence)).toEqual(Array.from({ length: 7 }, (_, index) => index + 1));
    expect(older).toMatchObject({ total: 57, hasOlder: false, nextBeforeSequence: null });
  });

  it("fails closed when a paginated read finds a missing event in the journal", async () => {
    const { root, store, binding } = await fixture();
    for (let index = 1; index <= 3; index += 1) {
      await store.append(binding.sessionKey, { kind: "assistant", text: `event ${index}`, sourceRef: `page-gap:${index}` });
    }
    const missing = path.join(root, "extension-storage", "session-memory", "sessions", binding.sessionKey, "events", "000000000002.json");
    await rm(missing);
    await expect(store.readEventsPage(binding.sessionKey)).rejects.toThrow("缺口");
  });

  it("refuses a retry whose source reference was reused for different content", async () => {
    const { store, binding } = await fixture();
    await store.append(binding.sessionKey, { kind: "user", text: "original", sourceRef: "event-1" });
    await expect(store.append(binding.sessionKey, { kind: "user", text: "changed", sourceRef: "event-1" })).rejects.toThrow("拒绝覆盖");
    expect((await store.readEvents(binding.sessionKey)).map((event) => event.text)).toEqual(["original"]);
  });

  it("recovers an event committed before a stale cursor and does not duplicate it on retry", async () => {
    const { root, store, binding } = await fixture();
    const input = { kind: "user" as const, text: "recovered", sourceRef: "event:recovery" };
    const saved = await store.append(binding.sessionKey, input);
    const cursorFile = path.join(root, "extension-storage", "session-memory", "sessions", binding.sessionKey, "cursor.json");
    await (await import("node:fs/promises")).writeFile(cursorFile, JSON.stringify({ schemaVersion: 1, sessionKey: binding.sessionKey, nextSequence: 1, sourceRefs: {} }));
    const retry = await store.append(binding.sessionKey, input);
    expect(retry.duplicate).toBe(true);
    expect(retry.event.id).toBe(saved.event.id);
    expect((await store.readEvents(binding.sessionKey)).map(({ sequence }) => sequence)).toEqual([1]);
  });

  it("serializes concurrent extension-host writers without reordering events", async () => {
    const { root, binding } = await fixture();
    const storage = path.join(root, "extension-storage");
    const left = new LocalSessionStore(storage);
    const right = new LocalSessionStore(storage);
    const result = await Promise.all([
      left.append(binding.sessionKey, { kind: "user", text: "first", sourceRef: "event:first" }),
      right.append(binding.sessionKey, { kind: "assistant", text: "second", sourceRef: "event:second" }),
    ]);
    expect(result.map(({ event }) => event.sequence).sort()).toEqual([1, 2]);
    expect((await left.readEvents(binding.sessionKey)).map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  it("shares the writer lock when the same storage directory is reached through a symlink", async () => {
    const { root } = await fixture();
    const storage = path.join(root, "extension-storage");
    const alias = path.join(root, "extension-storage-alias");
    await symlink(storage, alias);
    const left = new LocalSessionStore(storage);
    const right = new LocalSessionStore(alias);
    const leftWithLock = left as unknown as { withLock<T>(operation: () => Promise<T>): Promise<T> };
    const rightWithLock = right as unknown as { withLock<T>(operation: () => Promise<T>): Promise<T> };

    let releaseHeldLock!: () => void;
    let announceHeldLock!: () => void;
    const hold = new Promise<void>((resolve) => { releaseHeldLock = resolve; });
    const held = new Promise<void>((resolve) => { announceHeldLock = resolve; });
    let rightEntered = false;
    const first = leftWithLock.withLock(async () => { announceHeldLock(); await hold; });
    await held;
    const second = rightWithLock.withLock(async () => { rightEntered = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(rightEntered).toBe(false);
    } finally {
      releaseHeldLock();
    }
    await Promise.all([first, second]);
    expect(rightEntered).toBe(true);
  });

  it("completes binding initialization when retrying after the index was saved", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-session-bind-recovery-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const storage = path.join(root, "extension-storage");
    await mkdir(workspace);
    const input = { provider: "codex" as const, providerSessionId: "interrupted-bind", workspacePath: workspace, projectId: "project-1", taskId: "task-1" };
    const interrupted = new LocalSessionStore(storage);
    const writes = interrupted as unknown as { writeJsonAtomic(file: string, value: unknown): Promise<void> };
    const writeJsonAtomic = writes.writeJsonAtomic.bind(interrupted);
    writes.writeJsonAtomic = async (file, value) => {
      await writeJsonAtomic(file, value);
      if (file.endsWith("bindings.json")) throw new Error("simulated process interruption after binding index save");
    };

    await expect(interrupted.bind(input)).rejects.toThrow("simulated process interruption");
    const recovered = await new LocalSessionStore(storage).bind(input);
    const appended = await new LocalSessionStore(storage).append(recovered.sessionKey, { kind: "user", text: "retry succeeded", sourceRef: "recovery:1" });
    expect(appended.event.sequence).toBe(1);
    expect((await new LocalSessionStore(storage).readEvents(recovered.sessionKey)).map((event) => event.text)).toEqual(["retry succeeded"]);
  });

  it("fails closed when a local journal is malformed", async () => {
    const { root, binding, store } = await fixture();
    const journal = path.join(root, "extension-storage", "session-memory", "sessions", binding.sessionKey, "events", "000000000001.json");
    await (await import("node:fs/promises")).writeFile(journal, "{broken", { mode: 0o600 });
    await expect(store.readEvents(binding.sessionKey)).rejects.toThrow("日志损坏");
  });
});
