import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSessionStore } from "../src/session-memory/local-store";
import { createInputSnapshot, stableStringify, workspaceScopeHash } from "../src/memory/input-snapshot";
import { prepareExtractionInput } from "../src/memory/input-builder";
import { MemoryDraftError, MemoryDraftStore } from "../src/memory/draft-store";
import { MemoryArtifactStore, createMemoryHandoffExport, parseMemoryHandoffExport } from "../src/memory/artifact-store";
import { buildHandoffMaterial, buildResumeContext } from "../src/memory/handoff-material";
import type { MemoryCandidateV1 } from "../src/memory/types";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-memory-draft-")); roots.push(root);
  const workspacePath = path.join(root, "workspace");
  const storageRoot = path.join(root, "storage");
  const { mkdir } = await import("node:fs/promises"); await mkdir(workspacePath);
  const events = new LocalSessionStore(storageRoot);
  const projectId = randomUUID(); const taskId = randomUUID();
  const binding = await events.bind({ provider: "codex", providerSessionId: "synthetic-native-id", workspacePath, projectId, taskId });
  await events.append(binding.sessionKey, { kind: "user", text: "synthetic: implement task", sourceRef: "synthetic:user" });
  await events.append(binding.sessionKey, { kind: "tool_call", text: "synthetic npm test", command: "npm test", toolCallId: "tool-1", sourceRef: "synthetic:call" });
  await events.append(binding.sessionKey, { kind: "tool_result", text: "synthetic 12 tests passed", exitCode: 0, toolCallId: "tool-1", sourceRef: "synthetic:result" });
  const scope = {
    serverOrigin: "http://localhost:3000/",
    actorScope: createHash("sha256").update("synthetic-actor").digest("hex"),
    workspaceScope: await workspaceScopeHash(workspacePath), projectId, taskId, sessionKey: binding.sessionKey,
  };
  const snapshot = await createInputSnapshot(scope, {
    store: events, workspacePath, localRepositoryId: randomUUID(),
    readRepository: async () => ({ rootPath: workspacePath, key: "local:synthetic", headSha: "a".repeat(40), branch: "main", dirty: false, recoveryBlockers: [] }),
  });
  const input = prepareExtractionInput(snapshot);
  const user = input.events.find((event) => event.kind === "user")!;
  const call = input.events.find((event) => event.kind === "tool_call")!;
  const result = input.events.find((event) => event.kind === "tool_result")!;
  const candidate: MemoryCandidateV1 = {
    goal: [{ text: "synthetic goal", support: "reported", evidenceRefs: [user.id] }],
    constraints: [], completed: [{ text: "synthetic tests pass", support: "captured", evidenceRefs: [call.id, result.id] }],
    remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [],
    tests: [{ command: "npm test", exitCode: 0, evidenceRefs: [call.id, result.id], support: "captured" }],
    model: "synthetic-model", inputTokens: 30, outputTokens: 20,
  };
  return { root, storageRoot, workspacePath, events, scope, snapshot, input, candidate };
}

describe("revisioned memory drafts and handoff artifacts", () => {
  it("preserves human edits and tombstones when the same candidate is re-extracted", async () => {
    const { storageRoot, snapshot, input, candidate } = await fixture();
    const store = new MemoryDraftStore(storageRoot);
    let draft = await store.createDraft(candidate, input, snapshot);
    const originalGoal = draft.items.goal[0];
    const deletedCompleted = draft.items.completed[0];
    draft = await store.applyDraftPatch(draft.draftId, draft.revision, { type: "edit-item", category: "goal", itemId: originalGoal.id, text: "human corrected goal" }, snapshot);
    draft = await store.applyDraftPatch(draft.draftId, draft.revision, { type: "delete-item", category: "completed", itemId: deletedCompleted.id }, snapshot);
    draft = await store.applyDraftPatch(draft.draftId, draft.revision, { type: "add-item", category: "decisions", text: "human-only decision" }, snapshot);
    draft = await store.mergeCandidate(draft.draftId, draft.revision, candidate, input, snapshot);
    expect(draft.items.goal.find((item) => item.id === originalGoal.id)?.text).toBe("human corrected goal");
    expect(draft.items.completed).toHaveLength(0);
    expect(draft.items.decisions.some((item) => item.text === "human-only decision" && item.origin === "human")).toBe(true);
    expect(draft.tombstones).toContain(deletedCompleted.candidateKey);
  });

  it("carries human edits, manual additions, and deletions into a new snapshot revision", async () => {
    const { storageRoot, workspacePath, events, scope, snapshot, input, candidate } = await fixture();
    const store = new MemoryDraftStore(storageRoot);
    let parent = await store.createDraft(candidate, input, snapshot);
    const goalId = parent.items.goal[0].id;
    const completedId = parent.items.completed[0].id;
    parent = await store.applyDraftPatch(parent.draftId, parent.revision, { type: "edit-item", category: "goal", itemId: goalId, text: "human corrected goal" }, snapshot);
    parent = await store.applyDraftPatch(parent.draftId, parent.revision, { type: "delete-item", category: "completed", itemId: completedId }, snapshot);
    parent = await store.applyDraftPatch(parent.draftId, parent.revision, { type: "add-item", category: "decisions", text: "human-only decision" }, snapshot);
    const accepted = await store.acceptDraft(parent.draftId, parent.revision, snapshot);

    await events.append(snapshot.scope.sessionKey, { kind: "assistant", text: "synthetic next iteration", sourceRef: "synthetic:next-iteration" });
    const nextSnapshot = await createInputSnapshot(scope, {
      store: events, workspacePath, localRepositoryId: randomUUID(),
      readRepository: async () => ({ rootPath: workspacePath, key: "local:synthetic", headSha: "a".repeat(40), branch: "main", dirty: false, recoveryBlockers: [] }),
    });
    const nextInput = prepareExtractionInput(nextSnapshot);
    const nextEventId = nextSnapshot.events.at(-1)!.id;
    const nextCandidate: MemoryCandidateV1 = {
      ...candidate,
      goal: [{ ...candidate.goal[0], evidenceRefs: [nextEventId] }],
      completed: [{ text: candidate.completed[0].text, support: "reported", evidenceRefs: [nextEventId] }],
    };
    const next = await store.createDraft(nextCandidate, nextInput, nextSnapshot, { parentDraft: accepted.draft });

    expect(next.parentMemoryId).toBe(accepted.draft.memoryId);
    expect(next.items.goal).toHaveLength(1);
    expect(next.items.goal[0]).toMatchObject({ text: "human corrected goal", origin: "human" });
    expect(next.items.completed).toHaveLength(0);
    expect(next.items.decisions.some((item) => item.text === "human-only decision" && item.origin === "human")).toBe(true);
  });

  it("rejects stale revisions, accepts an immutable strict V1 document, and builds honest receiver blockers", async () => {
    const { storageRoot, workspacePath, events, scope, snapshot, input, candidate } = await fixture();
    const store = new MemoryDraftStore(storageRoot);
    const created = await store.createDraft(candidate, input, snapshot);
    const edited = await store.applyDraftPatch(created.draftId, created.revision, { type: "edit-item", category: "goal", itemId: created.items.goal[0].id, text: "human approved goal" }, snapshot);
    await expect(store.applyDraftPatch(edited.draftId, edited.revision, { type: "edit-test", testId: edited.tests[0].id, command: "npm run test", exitCode: 0 }, snapshot))
      .rejects.toMatchObject({ code: "INVALID_EVIDENCE" } satisfies Partial<MemoryDraftError>);
    await expect(store.applyDraftPatch(edited.draftId, created.revision, { type: "delete-item", category: "goal", itemId: created.items.goal[0].id }, snapshot))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" } satisfies Partial<MemoryDraftError>);
    const accepted = await store.acceptDraft(edited.draftId, edited.revision, snapshot);
    expect(accepted.draft.status).toBe("accepted");
    expect(accepted.document.goal[0].text).toBe("human approved goal");
    await expect(store.applyDraftPatch(accepted.draft.draftId, accepted.draft.revision, { type: "delete-item", category: "goal", itemId: accepted.draft.items.goal[0].id }, snapshot))
      .rejects.toMatchObject({ code: "DRAFT_ACCEPTED" } satisfies Partial<MemoryDraftError>);

    await events.append(snapshot.scope.sessionKey, { kind: "assistant", text: "synthetic next iteration", sourceRef: "synthetic:next-iteration" });
    const nextSnapshot = await createInputSnapshot(scope, {
      store: events, workspacePath, localRepositoryId: randomUUID(),
      readRepository: async () => ({ rootPath: workspacePath, key: "local:synthetic", headSha: "a".repeat(40), branch: "main", dirty: false, recoveryBlockers: [] }),
    });
    const nextInput = prepareExtractionInput(nextSnapshot);
    const nextDraft = await store.createDraft(candidate, nextInput, nextSnapshot, { parentMemoryId: accepted.draft.memoryId });
    expect(nextDraft.parentMemoryId).toBe(accepted.draft.memoryId);

    const material = buildHandoffMaterial(accepted.draft, snapshot, accepted.draft.revision);
    const resume = buildResumeContext(material, { repositoryKeyHash: null, currentHeadSha: null, workspaceReady: false, workspaceClean: false, workspaceBlockers: [], receivedRevision: null, accessConfirmed: false });
    expect(resume.ready).toBe(false);
    expect(resume.blockers.length).toBeGreaterThanOrEqual(4);
    expect(resume.instructions).toContain("human approved goal");
    const ready = buildResumeContext(material, {
      repositoryKeyHash: material.repositoryKeyHash, currentHeadSha: material.baseSha,
      workspaceReady: true, workspaceClean: true, workspaceBlockers: [],
      receivedRevision: material.revision, accessConfirmed: true,
    });
    expect(ready.ready).toBe(true);
  });

  it("persists an export that omits original transcript text and refuses mismatched memory/material", async () => {
    const { storageRoot, snapshot, input, candidate } = await fixture();
    const store = new MemoryDraftStore(storageRoot);
    const created = await store.createDraft(candidate, input, snapshot);
    const accepted = await store.acceptDraft(created.draftId, created.revision, snapshot);
    const material = buildHandoffMaterial(accepted.draft, snapshot, accepted.draft.revision);
    const artifacts = new MemoryArtifactStore(storageRoot);
    const events = new Set(snapshot.events.map((event) => event.id));
    const memoryFile = await artifacts.saveAcceptedDocument(accepted.document, events);
    const materialFile = await artifacts.saveHandoffMaterial(material);
    expect(await readFile(memoryFile, "utf8")).toContain("synthetic goal");
    expect(await readFile(materialFile, "utf8")).toContain(material.materialDigest);
    const exported = createMemoryHandoffExport(accepted.document, material);
    expect(parseMemoryHandoffExport(exported).material.materialId).toBe(material.materialId);
    const mismatched = structuredClone(exported);
    mismatched.material.goal = ["tampered synthetic goal"];
    const { materialDigest: _digest, ...materialBody } = mismatched.material;
    mismatched.material.materialDigest = createHash("sha256").update(stableStringify(materialBody)).digest("hex");
    expect(() => parseMemoryHandoffExport(mismatched)).toThrow("接班材料记忆内容与人工接受的记忆版本不一致");
    const receiverScope = { ...snapshot.scope, actorScope: "f".repeat(64), workspaceScope: "e".repeat(64) };
    const receivedFile = await artifacts.saveReceivedExport(exported, receiverScope);
    expect(await readFile(receivedFile, "utf8")).toContain("agilecampus-memory-handoff");
    const output = path.join(storageRoot, "manual-share.json");
    await artifacts.export(exported, output);
    const bytes = await readFile(output, "utf8");
    expect(bytes).toContain("agilecampus-memory-handoff");
    expect(bytes).not.toContain("synthetic 12 tests passed");
    await expect(artifacts.export({ ...exported, memory: { ...exported.memory, revision: 999 } }, path.join(storageRoot, "bad.json")))
      .rejects.toThrow("不匹配");
  });
});
