import { randomUUID } from "node:crypto";
import type { TaskDetail } from "../types";
import type { RepositorySnapshot } from "../git/repository-service";
import type { WorkCheckpoint } from "../checkpoints/types";
import { parseMemoryHandoffExport } from "./artifact-store";
import { prepareMemoryContinuation } from "./continuation";
import { sha256 } from "./input-snapshot";

/** Creates a NEW receiver-side task snapshot only after checking the imported code baseline. */
export function createReceivedMemoryCheckpoint(value: unknown, task: TaskDetail, repository: RepositorySnapshot, serverOrigin: string): WorkCheckpoint {
  const handoff = parseMemoryHandoffExport(value); const { material, memory } = handoff;
  const checked = prepareMemoryContinuation(handoff, {
    serverOrigin, projectId: task.projectId, taskId: task.id, repositoryKeyHash: sha256(repository.key),
    currentHeadSha: repository.headSha, workspaceReady: true, workspaceClean: !repository.dirty,
    workspaceBlockers: repository.recoveryBlockers, receivedRevision: memory.revision, accessConfirmed: true,
  });
  if (!checked.resume.ready) throw new Error(checked.resume.blockers.join("；"));
  return {
    schemaVersion: 1, id: randomUUID(), parentCheckpointId: null, serverOrigin: new URL(serverOrigin).toString(),
    projectId: task.projectId, taskId: task.id, milestoneId: null, capturedAt: new Date().toISOString(),
    handoffVersion: task.handoffVersion, taskUpdatedAt: task.updatedAt,
    taskSnapshot: {
      title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate,
      assigneeId: task.assigneeId, assigneeName: task.assigneeName, description: task.description,
      handoffBrief: task.handoffBrief, doneCriteria: task.doneCriteria, requiredEvidence: task.requiredEvidence,
      responseDueAt: task.responseDueAt, completionNote: task.completionNote, committedHandoffVersion: task.committedHandoffVersion,
    },
    repository: { key: repository.key, headSha: repository.headSha, branch: repository.branch, dirty: false, dirtyPolicy: "clean-only", recoveryBlockers: [] },
    session: { provider: "task-memory", providerVersion: "1", sessionId: null, checkpointId: null, captureMode: "context-only" },
    handoff: { goal: material.goal[0] || task.title, completed: material.completed, remaining: material.remaining,
      blocker: material.blockers.join("\n") || null, rejectedApproaches: material.rejectedApproaches, nextAction: material.nextActions[0] || "核对任务与当前代码" },
    tests: material.tests.map((test) => ({ command: test.command, exitCode: test.exitCode, recordedAt: memory.provenance.createdAt,
      source: test.support === "captured" ? "captured" : "user-reported" })), artifacts: [],
  };
}
