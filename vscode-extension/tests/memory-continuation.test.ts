import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContinuationFixture } from "./fixtures/session-memory/continuation-fixture";
import { inheritedMemoryEvent, inheritedParentMemoryId, inheritedParentMemoryReference, parseContinuationRequest, parseMemoryInheritance, prepareMemoryContinuation } from "../src/memory/continuation";
import { MemoryArtifactStore, parseMemoryHandoffExport } from "../src/memory/artifact-store";
import { sha256, stableStringify } from "../src/memory/input-snapshot";
import { AttemptStore } from "../src/attempts/store";
import { buildContextPrompt } from "../src/handoff/launch";
import { readRepositorySnapshot } from "../src/git/repository-service";
import { LocalSessionStore } from "../src/session-memory/local-store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-memory-continuation-")); roots.push(root);
  return createContinuationFixture(root);
}

describe("task memory inheritance", () => {
  it("reloads immutable accepted/imported versions within the exact actor/workspace/task scope", async () => {
    const f = await fixture();
    const file = await f.artifactStore.saveReceivedExport(f.handoff, f.scope);
    const before = await readFile(file, "utf8");
    await f.events.append(f.binding.sessionKey, { kind: "assistant", text: "synthetic later source activity", sourceRef: "synthetic:later" });
    const reloaded = await new MemoryArtifactStore(f.storageRoot).listReceivedExports(f.scope);
    expect(reloaded).toEqual([f.handoff]);
    expect(await readFile(file, "utf8")).toBe(before);
    for (const scope of [{ ...f.scope, actorScope: "f".repeat(64) }, { ...f.scope, workspaceScope: "f".repeat(64) }, { ...f.scope, taskId: randomUUID() }]) {
      expect(await f.artifactStore.listReceivedExports(scope)).toEqual([]);
    }
    const changed = structuredClone(f.handoff);
    changed.memory.provenance.model = "different synthetic model";
    await expect(f.artifactStore.saveReceivedExport(changed, f.scope)).rejects.toThrow("拒绝覆盖");
  });

  it("rejects tampered bodies, mismatched dirty coverage, and unsafe task library files", async () => {
    const f = await fixture();
    const changed = structuredClone(f.handoff);
    changed.memory.code.dirtyExcluded = true;
    expect(() => parseMemoryHandoffExport(changed)).toThrow("不匹配");
    const file = await f.artifactStore.saveReceivedExport(f.handoff, f.scope);
    await rm(file);
    const external = path.join(f.root, "external.json");
    await writeFile(external, JSON.stringify(f.handoff));
    await symlink(external, file);
    await expect(f.artifactStore.listReceivedExports(f.scope)).rejects.toThrow("文件无效");
  });

  it("injects decisions, failed approaches and evidence kinds exactly once into the actual launch prompt", async () => {
    const f = await fixture();
    const continuation = prepareMemoryContinuation(f.handoff, f.receiver);
    expect(continuation.resume.ready).toBe(true);
    const prompt = buildContextPrompt(f.checkpoint, f.task, [], continuation);
    expect(prompt.match(/synthetic: cache approach returns stale results/g)).toHaveLength(1);
    expect(prompt).toContain('"support":"inferred"');
    expect(prompt).toContain(f.handoff.memory.tests[0].evidenceRefs[0]);
    expect(prompt).toContain("历史测试通过不代表当前测试通过");
    expect(continuation.report).toContain("通过，尚未启动");
    expect(prompt).not.toContain("synthetic-native-source");
    expect(prompt).not.toContain(f.workspacePath);
    expect(() => buildContextPrompt({ ...f.checkpoint, taskId: randomUUID() }, f.task, [], continuation)).toThrow("不一致");
  });

  it("blocks real Git changes, dirty working files, wrong task and wrong repository before launch", async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspacePath, "search.ts"), "export const search = () => ['changed'];\n");
    let repository = await readRepositorySnapshot(f.workspacePath, f.localId);
    expect(prepareMemoryContinuation(f.handoff, { ...f.receiver, workspaceClean: !repository.dirty }).resume.ready).toBe(false);
    f.git("add", "search.ts");
    f.git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "synthetic changed code");
    repository = await readRepositorySnapshot(f.workspacePath, f.localId);
    const stale = prepareMemoryContinuation(f.handoff, { ...f.receiver, currentHeadSha: repository.headSha });
    expect(stale.resume.blockers.join(" ")).toContain("基线不一致");
    expect(() => buildContextPrompt(f.checkpoint, f.task, [], stale)).toThrow("未通过");
    expect(prepareMemoryContinuation(f.handoff, { ...f.receiver, taskId: randomUUID() }).resume.ready).toBe(false);
    expect(prepareMemoryContinuation(f.handoff, { ...f.receiver, repositoryKeyHash: "f".repeat(64) }).resume.ready).toBe(false);
    expect(prepareMemoryContinuation(f.handoff, { ...f.receiver, accessConfirmed: false }).resume.ready).toBe(false);
  });

  it("persists parent memory beside the attempt, binds independent child event streams and never mutates the parent", async () => {
    const f = await fixture();
    const continuation = prepareMemoryContinuation(f.handoff, f.receiver);
    const attempts = new AttemptStore(f.storageRoot);
    const original = stableStringify(f.handoff);
    const children = [];
    for (const label of ["A", "B"]) {
      const providerSessionId = randomUUID();
      const attempt = await attempts.create({
        checkpointId: f.checkpoint.id, projectId: f.scope.projectId, taskId: f.scope.taskId,
        attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId,
        state: "launching", workdir: f.workspacePath, branch: "main", baseSha: f.repository.headSha,
        parentAttemptId: null, pid: null, exitCode: null, timedOut: false, memoryInheritance: continuation.inheritance,
      });
      const child = await f.events.bind({ provider: "codex", providerSessionId, workspacePath: f.workspacePath, projectId: f.scope.projectId, taskId: f.scope.taskId });
      await f.events.append(child.sessionKey, inheritedMemoryEvent(attempt.id, continuation));
      await f.events.append(child.sessionKey, { kind: "assistant", text: `synthetic private result ${label}`, sourceRef: `synthetic:${label}` });
      children.push(child);
    }
    const a = await f.events.readEvents(children[0].sessionKey);
    const b = await f.events.readEvents(children[1].sessionKey);
    expect(a[0].text).toBe(continuation.resume.instructions);
    expect(b.map((event) => event.text).join("\n")).not.toContain("private result A");
    expect(a[0].sessionKey).not.toBe(b[0].sessionKey);
    expect(stableStringify(f.handoff)).toBe(original);
    const rows = await new AttemptStore(f.storageRoot).list();
    expect(await inheritedParentMemoryId(rows, children[0])).toBe(f.handoff.memory.id);
    expect(await inheritedParentMemoryReference(rows, children[0])).toEqual({ memoryId: f.handoff.memory.id, revision: f.handoff.memory.revision, memoryDigest: sha256(stableStringify(f.handoff.memory)) });
    const conflicting = { ...rows.find((row) => row.providerSessionId === children[0].providerSessionId)!, memoryInheritance: { ...continuation.inheritance, revision: continuation.inheritance.revision + 1 } };
    await expect(inheritedParentMemoryReference([...rows, conflicting], children[0])).rejects.toThrow("冲突");
    expect(await inheritedParentMemoryId(rows, { ...children[0], taskId: randomUUID() })).toBeNull();
    await expect(attempts.update(rows[0].id, { memoryInheritance: { ...continuation.inheritance, memoryId: randomUUID() } })).rejects.toThrow("不可覆盖");
    expect((await new LocalSessionStore(f.storageRoot).list(f.workspacePath)).length).toBe(3);
  });

  it("retains incomplete coverage, rejects oversized contexts and malformed inheritance receipts", async () => {
    const f = await fixture();
    const handoff = structuredClone(f.handoff);
    handoff.material.sourceRange.omittedEventIds = [randomUUID()];
    handoff.material.completeness = "partial";
    const body = { ...handoff.material } as Partial<typeof handoff.material>;
    delete body.materialDigest;
    handoff.material.materialDigest = sha256(stableStringify(body));
    const prepared = prepareMemoryContinuation(handoff, f.receiver);
    expect(prepared.report).toContain("未提炼 1");
    expect(prepared.resume.instructions).toContain('"completeness":"partial"');
    expect(() => parseMemoryInheritance({ ...prepared.inheritance, revision: 0 })).toThrow("格式无效");
    expect(() => parseMemoryInheritance({ ...prepared.inheritance, sourceToSequence: 0 })).toThrow("格式无效");
    handoff.memory.constraints = Array.from({ length: 100 }, () => ({
      id: randomUUID(), text: "x".repeat(2000), origin: "human" as const, support: "reported" as const,
      disposition: "active" as const, evidenceRefs: [],
    }));
    handoff.material.constraints = handoff.memory.constraints.map((item) => item.text);
    handoff.material.evidenceIndex.push(...handoff.memory.constraints.map((item) => ({ itemId: item.id, eventIds: [] })));
    const largeBody = { ...handoff.material } as Partial<typeof handoff.material>;
    delete largeBody.materialDigest;
    handoff.material.materialDigest = sha256(stableStringify(largeBody));
    expect(() => prepareMemoryContinuation(handoff, f.receiver)).toThrow("超过 192 KiB");
  });

  it("accepts only task-scoped command identifiers and rejects paths or unexpected parameters", () => {
    const taskId = randomUUID(); const materialId = randomUUID();
    expect(parseContinuationRequest({ taskId, materialId })).toEqual({ taskId, materialId });
    expect(() => parseContinuationRequest({ taskId, materialId: "../../private" })).toThrow("参数无效");
    expect(() => parseContinuationRequest({ taskId, workdir: "/tmp/arbitrary" })).toThrow("参数无效");
  });
});
