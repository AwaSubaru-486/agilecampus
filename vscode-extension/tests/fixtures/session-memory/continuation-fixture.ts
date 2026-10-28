import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { LocalSessionStore } from "../../../src/session-memory/local-store";
import { readRepositorySnapshot } from "../../../src/git/repository-service";
import { createInputSnapshot, sha256, workspaceScopeHash } from "../../../src/memory/input-snapshot";
import { prepareExtractionInput } from "../../../src/memory/input-builder";
import { MemoryDraftStore } from "../../../src/memory/draft-store";
import { MemoryArtifactStore, createMemoryHandoffExport } from "../../../src/memory/artifact-store";
import { buildHandoffMaterial } from "../../../src/memory/handoff-material";
import type { MemoryCandidateV1 } from "../../../src/memory/types";
import type { WorkCheckpoint } from "../../../src/checkpoints/types";
import type { TaskDetail } from "../../../src/types";

/** Synthetic conversations, real temporary Git repository; never reads personal CLI sessions. */
export async function createContinuationFixture(root: string) {
  const workspacePath = path.join(root, "workspace");
  const storageRoot = path.join(root, "storage");
  await mkdir(workspacePath);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: workspacePath, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Synthetic Test");
  git("config", "user.email", "synthetic@example.invalid");
  await writeFile(path.join(workspacePath, "search.ts"), "export const search = () => [];\n");
  git("add", "search.ts");
  git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "synthetic baseline");
  const localId = randomUUID();
  const repository = await readRepositorySnapshot(workspacePath, localId);
  const events = new LocalSessionStore(storageRoot);
  const projectId = randomUUID(); const taskId = randomUUID();
  const binding = await events.bind({ provider: "codex", providerSessionId: "synthetic-native-source", workspacePath, projectId, taskId });
  await events.append(binding.sessionKey, { kind: "user", text: "synthetic: fix search performance; cache approach failed on stale results", sourceRef: "synthetic:user" });
  await events.append(binding.sessionKey, { kind: "tool_call", text: "synthetic tool call", command: "npm test", toolCallId: "synthetic-tool", sourceRef: "synthetic:call" });
  await events.append(binding.sessionKey, { kind: "tool_result", text: "synthetic passing tests", exitCode: 0, toolCallId: "synthetic-tool", sourceRef: "synthetic:result" });
  const serverOrigin = "http://localhost:3000/";
  const actorId = "synthetic-actor";
  const scope = {
    serverOrigin, actorScope: sha256(`agilecampus-actor-v1\0${serverOrigin}\0${actorId}`),
    workspaceScope: await workspaceScopeHash(workspacePath), projectId, taskId, sessionKey: binding.sessionKey,
  };
  const snapshot = await createInputSnapshot(scope, { store: events, workspacePath, localRepositoryId: localId });
  const input = prepareExtractionInput(snapshot);
  const [user, call, result] = input.events;
  const candidate: MemoryCandidateV1 = {
    goal: [{ text: "synthetic: fix search performance", support: "reported", evidenceRefs: [user.id] }],
    constraints: [], completed: [], remaining: [], decisions: [],
    rejectedApproaches: [{ text: "synthetic: cache approach returns stale results", support: "reported", evidenceRefs: [user.id] }],
    blockers: [], nextActions: [{ text: "synthetic: inspect database indexes", support: "inferred", evidenceRefs: [user.id] }],
    tests: [{ command: "npm test", exitCode: 0, evidenceRefs: [call.id, result.id], support: "captured" }],
    model: "synthetic-model", inputTokens: 40, outputTokens: 30,
  };
  const drafts = new MemoryDraftStore(storageRoot);
  const draft = await drafts.createDraft(candidate, input, snapshot);
  const accepted = await drafts.acceptDraft(draft.draftId, draft.revision, snapshot);
  const material = buildHandoffMaterial(accepted.draft, snapshot, accepted.draft.revision);
  const handoff = createMemoryHandoffExport(accepted.document, material);
  const artifactStore = new MemoryArtifactStore(storageRoot);
  const task: TaskDetail = {
    id: taskId, projectId, title: "synthetic search task", status: "doing", priority: "medium", dueDate: null,
    assigneeId: null, assigneeName: null, description: "synthetic task", handoffBrief: "synthetic handoff",
    doneCriteria: ["synthetic test evidence"], requiredEvidence: [], updatedAt: "2026-10-25T01:00:00.000Z",
    completionNote: null, responseDueAt: null, handoffVersion: 1, committedHandoffVersion: null,
  };
  const taskSnapshot: WorkCheckpoint["taskSnapshot"] = {
    title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate,
    assigneeId: task.assigneeId, assigneeName: task.assigneeName, description: task.description,
    handoffBrief: task.handoffBrief, doneCriteria: task.doneCriteria, requiredEvidence: task.requiredEvidence,
    responseDueAt: task.responseDueAt, completionNote: task.completionNote, committedHandoffVersion: task.committedHandoffVersion,
  };
  const checkpoint: WorkCheckpoint = {
    schemaVersion: 1, id: randomUUID(), parentCheckpointId: null, serverOrigin, projectId, taskId, milestoneId: null,
    capturedAt: "2026-10-25T02:00:00.000Z", handoffVersion: task.handoffVersion, taskUpdatedAt: task.updatedAt,
    taskSnapshot, repository: { key: repository.key, headSha: repository.headSha, branch: repository.branch, dirty: false, dirtyPolicy: "clean-only", recoveryBlockers: [] },
    session: { provider: "codex-cli", providerVersion: "0.153.4", sessionId: null, checkpointId: null, captureMode: "context-only" },
    handoff: { goal: task.title, completed: [], remaining: [], blocker: null, rejectedApproaches: [], nextAction: "synthetic next" },
    tests: [], artifacts: [],
  };
  const receiver = {
    serverOrigin, projectId, taskId, repositoryKeyHash: material.repositoryKeyHash, currentHeadSha: repository.headSha,
    workspaceReady: true, workspaceClean: true, workspaceBlockers: [], receivedRevision: material.revision, accessConfirmed: true,
  };
  return { root, workspacePath, storageRoot, git, localId, repository, events, scope, handoff, artifactStore, task, checkpoint, receiver, actorId, binding, drafts };
}
