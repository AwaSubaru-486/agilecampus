import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NormalizedEventV1 } from "../../shared/session-memory/types";
import { LocalSessionStore } from "../src/session-memory/local-store";
import { createInputSnapshot, MemorySnapshotError, workspaceScopeHash } from "../src/memory/input-snapshot";
import { MemorySnapshotStore } from "../src/memory/snapshot-store";
import type { MemoryScope } from "../src/memory/types";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-memory-snapshot-"));
  roots.push(root);
  const workspacePath = path.join(root, "workspace");
  const storageRoot = path.join(root, "extension-storage");
  await mkdir(workspacePath);
  const store = new LocalSessionStore(storageRoot, () => new Date("2026-10-05T12:00:00.000Z"));
  const projectId = randomUUID();
  const taskId = randomUUID();
  const binding = await store.bind({ provider: "codex", providerSessionId: "native-only-session", workspacePath, projectId, taskId });
  const scope: MemoryScope = {
    serverOrigin: "http://localhost:3000/",
    actorScope: createHash("sha256").update("actor-1").digest("hex"),
    workspaceScope: await workspaceScopeHash(workspacePath), projectId, taskId, sessionKey: binding.sessionKey,
  };
  const repository = {
    rootPath: workspacePath, key: "local:test-repository", headSha: "a".repeat(40), branch: "main",
    dirty: false, recoveryBlockers: [],
  };
  const create = (now = new Date("2026-10-05T12:01:00.000Z"), makeId = randomUUID) => createInputSnapshot(scope, {
    store, workspacePath, localRepositoryId: randomUUID(), now: () => now, makeId,
    readRepository: async () => repository,
  });
  return { root, workspacePath, storageRoot, store, binding, scope, create };
}

function event(sessionKey: string, sequence: number, text: string): NormalizedEventV1 {
  return {
    schemaVersion: 1, id: randomUUID(), sessionKey, sequence, timestamp: "2026-10-05T12:00:00.000Z",
    kind: "assistant", text, sourceRef: `synthetic:${sequence}`,
  };
}

describe("immutable extraction snapshots", () => {
  it("freezes the current event prefix and remains unchanged after new capture events", async () => {
    const { store, binding, scope, create, storageRoot } = await fixture();
    await store.append(binding.sessionKey, { kind: "user", text: "synthetic prompt", sourceRef: "s1" });
    await store.append(binding.sessionKey, { kind: "assistant", text: "synthetic answer", sourceRef: "s2" });
    const snapshot = await create(undefined, () => "11111111-1111-4111-8111-111111111111");
    const repository = new MemorySnapshotStore(storageRoot);
    await repository.saveSnapshot(snapshot);
    await store.append(binding.sessionKey, { kind: "assistant", text: "later response", sourceRef: "s3" });
    const loaded = await repository.loadSnapshot(snapshot.snapshotId, scope);
    expect(loaded.events.map((item) => item.sequence)).toEqual([1, 2]);
    expect(loaded.captureDigest).toBe(snapshot.captureDigest);
  });

  it("records concurrent appends in one ordered frozen prefix and rejects empty captures", async () => {
    const { store, binding, create } = await fixture();
    await expect(create()).rejects.toMatchObject({ code: "EMPTY_CAPTURE" } satisfies Partial<MemorySnapshotError>);
    await Promise.all([
      store.append(binding.sessionKey, { kind: "assistant", text: "synthetic concurrent A", sourceRef: "concurrent:a" }),
      store.append(binding.sessionKey, { kind: "assistant", text: "synthetic concurrent B", sourceRef: "concurrent:b" }),
    ]);
    const snapshot = await create();
    expect(snapshot.events.map((item) => item.sequence)).toEqual([1, 2]);
  });

  it("keeps capture failure details local and marks incomplete provenance", async () => {
    const { store, binding, create } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "synthetic saved event", sourceRef: "failure:record" });
    await store.recordCaptureFailure(binding.sessionKey, "synthetic local-only hook failure details");
    const snapshot = await create();
    expect(snapshot.captureCompleteness).toBe("partial");
    expect(snapshot.captureFailures).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("synthetic local-only hook failure details");
  });

  it("refuses a corrupt event journal and preserves source events when Git has no initial commit", async () => {
    const { store, binding, workspacePath, scope, storageRoot } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "synthetic durable source", sourceRef: "corrupt-event" });
    const eventFile = path.join(storageRoot, "session-memory", "sessions", binding.sessionKey, "events", "000000000001.json");
    await writeFile(eventFile, "{}");
    await expect(store.freezeCapture(binding.sessionKey)).rejects.toThrow();
    expect(await readFile(eventFile, "utf8")).toBe("{}");

    const noHead = new LocalSessionStore(path.join(storageRoot, "no-head"));
    const secondBinding = await noHead.bind({ provider: "codex", providerSessionId: "synthetic-no-head", workspacePath, projectId: scope.projectId, taskId: scope.taskId });
    await noHead.append(secondBinding.sessionKey, { kind: "assistant", text: "synthetic still local", sourceRef: "no-head" });
    await expect(createInputSnapshot({ ...scope, sessionKey: secondBinding.sessionKey }, {
      store: noHead, workspacePath, localRepositoryId: randomUUID(),
      readRepository: async () => { throw new Error("当前目录没有可读取的 Git 提交；请先建立首个提交"); },
    })).rejects.toThrow("建立首个提交");
    expect((await noHead.readEvents(secondBinding.sessionKey)).map((item) => item.text)).toEqual(["synthetic still local"]);
  });

  it("rejects a frozen source journal above the 10 MiB cap without sending or truncating it", async () => {
    const { store, binding, storageRoot } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "synthetic seed", sourceRef: "oversize-seed" });
    const seed = (await store.readEvents(binding.sessionKey))[0];
    const eventsDirectory = path.join(storageRoot, "session-memory", "sessions", binding.sessionKey, "events");
    const text = "x".repeat(256 * 1024);
    for (let sequence = 1; sequence <= 41; sequence += 1) {
      const eventValue = { ...seed, id: randomUUID(), sequence, text, sourceRef: `synthetic:oversize:${sequence}` };
      await writeFile(path.join(eventsDirectory, `${String(sequence).padStart(12, "0")}.json`), JSON.stringify(eventValue), { mode: 0o600 });
    }
    await writeFile(path.join(storageRoot, "session-memory", "sessions", binding.sessionKey, "cursor.json"), JSON.stringify({
      schemaVersion: 1, sessionKey: binding.sessionKey, nextSequence: 42, hasGaps: false,
    }), { mode: 0o600 });
    await expect(store.freezeCapture(binding.sessionKey)).rejects.toThrow("SNAPSHOT_TOO_LARGE");
    expect((await readFile(path.join(eventsDirectory, "000000000041.json"), "utf8"))).toContain(text.slice(0, 100));
  });

  it("uses a stable content digest independent of snapshot ID and creation time", async () => {
    const { store, binding, create } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "same synthetic result", sourceRef: "same" });
    const first = await create(new Date("2026-10-05T12:01:00.000Z"), () => "11111111-1111-4111-8111-111111111111");
    const second = await create(new Date("2026-10-05T12:09:00.000Z"), () => "22222222-2222-4222-8222-222222222222");
    expect(first.snapshotId).not.toBe(second.snapshotId);
    expect(first.captureDigest).toBe(second.captureDigest);
  });

  it("rejects another task or account scope when loading", async () => {
    const { store, binding, scope, create, storageRoot } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "synthetic", sourceRef: "scope" });
    const snapshot = await create();
    const repository = new MemorySnapshotStore(storageRoot);
    await repository.saveSnapshot(snapshot);
    await expect(repository.loadSnapshot(snapshot.snapshotId, { ...scope, taskId: randomUUID() })).rejects.toThrow("不属于当前");
    await expect(repository.loadSnapshot(snapshot.snapshotId, { ...scope, actorScope: "f".repeat(64) })).rejects.toThrow("不属于当前");
  });

  it("rejects a modified snapshot and a symlinked snapshot directory", async () => {
    const { root, store, binding, create, storageRoot } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "immutable", sourceRef: "tamper" });
    const snapshot = await create();
    const repository = new MemorySnapshotStore(storageRoot);
    const tampered = { ...snapshot, events: [{ ...snapshot.events[0], text: "modified" }] };
    await expect(repository.saveSnapshot(tampered)).rejects.toThrow("事件顺序");

    const external = path.join(root, "external");
    const unsafeStorage = path.join(root, "unsafe-storage");
    await mkdir(external);
    await mkdir(unsafeStorage);
    const linkPath = path.join(unsafeStorage, "session-memory");
    await symlink(external, linkPath);
    await expect(new MemorySnapshotStore(unsafeStorage).saveSnapshot(snapshot)).rejects.toThrow("符号链接");
  });

  it("does not export provider-native session IDs or absolute workspace paths", async () => {
    const { store, binding, scope, create, storageRoot, workspacePath } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "synthetic content", sourceRef: "native-redaction" });
    const snapshot = await create();
    const repository = new MemorySnapshotStore(storageRoot);
    await repository.saveSnapshot(snapshot);
    const file = await readFile(path.join(storageRoot, "session-memory", "snapshots", `${snapshot.snapshotId}.json`), "utf8");
    expect(file).not.toContain("native-only-session");
    expect(file).not.toContain(workspacePath);
    expect(snapshot.scope).toEqual(scope);
  });

  it("rejects changed Git HEAD while keeping the captured events in the source store", async () => {
    const { store, binding, workspacePath, scope } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "preserve this", sourceRef: "repo-change" });
    let reads = 0;
    await expect(createInputSnapshot(scope, {
      store, workspacePath, localRepositoryId: randomUUID(),
      readRepository: async () => ({
        rootPath: workspacePath, key: "local:test", headSha: ++reads === 1 ? "a".repeat(40) : "b".repeat(40),
        branch: "main", dirty: false, recoveryBlockers: [],
      }),
    })).rejects.toMatchObject({ code: "REPOSITORY_CHANGED" } satisfies Partial<MemorySnapshotError>);
    expect((await store.readEvents(binding.sessionKey)).map((item) => item.text)).toEqual(["preserve this"]);
  });

  it("refuses a corrupted serialized file on load", async () => {
    const { store, binding, scope, create, storageRoot } = await fixture();
    await store.append(binding.sessionKey, { kind: "assistant", text: "synthetic", sourceRef: "corrupt" });
    const snapshot = await create();
    const repository = new MemorySnapshotStore(storageRoot);
    await repository.saveSnapshot(snapshot);
    await writeFile(path.join(storageRoot, "session-memory", "snapshots", `${snapshot.snapshotId}.json`), "{}", { mode: 0o600 });
    await expect(repository.loadSnapshot(snapshot.snapshotId, scope)).rejects.toThrow("结构无效");
  });
});
