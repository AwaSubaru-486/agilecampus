import { createHash } from "node:crypto";
import type { CheckpointIndexPayload, ServerCheckpoint, ServerCheckpointSummary } from "../agilecampus/api-client";
import type { WorkCheckpoint } from "./types";

export function toCheckpointIndexPayload(
  manifest: WorkCheckpoint,
  visibility: "project" | "assignee",
  serverParentCheckpointId: string | null,
): CheckpointIndexPayload {
  return {
    visibility,
    parentCheckpointId: serverParentCheckpointId,
    taskHandoffVersion: manifest.handoffVersion,
    taskUpdatedAt: manifest.taskUpdatedAt,
    repositoryKeyHash: createHash("sha256").update(manifest.repository.key).digest("hex"),
    headSha: manifest.repository.headSha,
    source: {
      provider: manifest.session.provider,
      providerVersion: manifest.session.providerVersion,
      captureMode: manifest.session.captureMode,
    },
    handoffSummary: {
      goal: manifest.handoff.goal,
      completed: manifest.handoff.completed,
      remaining: manifest.handoff.remaining,
      blocker: manifest.handoff.blocker,
      nextAction: manifest.handoff.nextAction,
    },
    materials: manifest.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      transferred: false,
    })),
  };
}

export function checkpointSummaryMatches(candidate: ServerCheckpointSummary, payload: CheckpointIndexPayload): boolean {
  return candidate.visibility === payload.visibility && candidate.taskHandoffVersion === payload.taskHandoffVersion &&
    candidate.taskUpdatedAt === payload.taskUpdatedAt && candidate.repositoryKeyHash === payload.repositoryKeyHash &&
    candidate.headSha === payload.headSha && JSON.stringify(candidate.source) === JSON.stringify(payload.source) &&
    JSON.stringify(candidate.handoffSummary) === JSON.stringify(payload.handoffSummary) && candidate.materialsCount === payload.materials.length;
}

export function fullCheckpointMatches(record: ServerCheckpoint, projectId: string, taskId: string, payload: CheckpointIndexPayload): boolean {
  return record.projectId === projectId && record.taskId === taskId && record.visibility === payload.visibility &&
    record.parentCheckpointId === payload.parentCheckpointId && record.taskHandoffVersion === payload.taskHandoffVersion &&
    record.taskUpdatedAt === payload.taskUpdatedAt && record.repositoryKeyHash === payload.repositoryKeyHash &&
    record.headSha === payload.headSha && JSON.stringify(record.source) === JSON.stringify(payload.source) &&
    JSON.stringify(record.handoffSummary) === JSON.stringify(payload.handoffSummary) &&
    JSON.stringify(record.materials) === JSON.stringify(payload.materials);
}
