import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContinuationFixture } from "./fixtures/session-memory/continuation-fixture";
import { resolveIterationParent } from "../src/memory/iteration-parent";
import { sha256, stableStringify } from "../src/memory/input-snapshot";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-parent-")); roots.push(root);
  const f = await createContinuationFixture(root);
  const reference = { memoryId: f.handoff.memory.id, revision: f.handoff.memory.revision, memoryDigest: sha256(stableStringify(f.handoff.memory)) };
  return { ...f, reference };
}

describe("exact parent recovery", () => {
  it("recovers a shared exact parent on an empty receiver and reuses the validated local cache offline", async () => {
    const f = await fixture();
    const fetchParent = vi.fn(async () => ({ payload: f.handoff }));
    const first = await resolveIterationParent(f.artifactStore, f.scope, f.reference, fetchParent);
    expect(first).toMatchObject({ source: "server", parent: f.handoff.memory });
    expect(fetchParent).toHaveBeenCalledExactlyOnceWith(f.reference);
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect(await resolveIterationParent(f.artifactStore, f.scope, f.reference, offline)).toMatchObject({ source: "local", parent: f.handoff.memory });
    expect(offline).not.toHaveBeenCalled();
  });
  it("rejects a different revision, content digest, or task without caching a substitute", async () => {
    const f = await fixture();
    for (const reference of [{ ...f.reference, revision: 99 }, { ...f.reference, memoryDigest: "f".repeat(64) }]) {
      const result = await resolveIterationParent(f.artifactStore, f.scope, reference, async () => ({ payload: f.handoff }));
      expect(result.source).toBe("unavailable"); expect(result.parent).toBeUndefined();
    }
    expect((await resolveIterationParent(f.artifactStore, { ...f.scope, taskId: randomUUID() }, f.reference, async () => ({ payload: f.handoff }))).source).toBe("unavailable");
    expect(await f.artifactStore.listReceivedExports(f.scope)).toEqual([]);
  });
  it("keeps review usable after permission or connection failure and allows an explicit retry", async () => {
    const f = await fixture();
    const unavailable = await resolveIterationParent(f.artifactStore, f.scope, f.reference, async () => { throw new Error("403 private detail"); });
    expect(unavailable.notice).toContain("可继续审核当前草稿");
    expect(unavailable.notice).not.toContain("private detail");
    expect((await resolveIterationParent(f.artifactStore, f.scope, f.reference, async () => ({ payload: f.handoff }))).source).toBe("server");
    const fetchParent = vi.fn();
    expect(await resolveIterationParent(f.artifactStore, f.scope, undefined, fetchParent)).toEqual({ source: "none" });
    expect(fetchParent).not.toHaveBeenCalled();
  });
});
