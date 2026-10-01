import type { WorkCheckpoint } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const HASH = /^[0-9a-f]{64}$/i;

export class CheckpointSchemaError extends Error {
  constructor(message: string) { super(message); this.name = "CheckpointSchemaError"; }
}

export function parseWorkCheckpoint(value: unknown): WorkCheckpoint {
  if (!record(value) || value.schemaVersion !== 1) throw new CheckpointSchemaError("检查点格式或版本无效");
  if (!UUID.test(text(value.id)) || (value.parentCheckpointId !== null && !UUID.test(text(value.parentCheckpointId)))) {
    throw new CheckpointSchemaError("检查点 ID 无效");
  }
  const repository = value.repository;
  const session = value.session;
  const taskSnapshot = value.taskSnapshot;
  const handoff = value.handoff;
  if (!record(repository) || !record(session) || !record(taskSnapshot) || !record(handoff)) throw new CheckpointSchemaError("检查点缺少必需字段");
  if (!text(value.serverOrigin) || !validServerUrl(text(value.serverOrigin)) || !text(value.projectId) || !text(value.taskId) || !text(value.taskUpdatedAt)) {
    throw new CheckpointSchemaError("项目、任务和更新时间不能为空");
  }
  if (value.milestoneId !== null && typeof value.milestoneId !== "string") throw new CheckpointSchemaError("里程碑标识无效");
  if (!validIso(value.capturedAt) || !Number.isInteger(value.handoffVersion) || (value.handoffVersion as number) < 1) {
    throw new CheckpointSchemaError("检查点时间或交接版本无效");
  }
  if (!text(repository.key) || !SHA.test(text(repository.headSha)) || typeof repository.dirty !== "boolean" ||
      !["clean-only", "excluded"].includes(text(repository.dirtyPolicy)) || !stringArray(repository.recoveryBlockers)) {
    throw new CheckpointSchemaError("Git 基线信息无效");
  }
  if (repository.branch !== null && typeof repository.branch !== "string") throw new CheckpointSchemaError("Git 分支信息无效");
  if (!text(taskSnapshot.title) || !text(taskSnapshot.status) || !text(taskSnapshot.priority) ||
      (taskSnapshot.dueDate !== undefined && !nullableText(taskSnapshot.dueDate)) ||
      !nullableText(taskSnapshot.assigneeId) || !nullableText(taskSnapshot.assigneeName) ||
      !nullableText(taskSnapshot.description) || !nullableText(taskSnapshot.handoffBrief) ||
      !stringArray(taskSnapshot.doneCriteria) || !stringArray(taskSnapshot.requiredEvidence) ||
      !nullableText(taskSnapshot.responseDueAt) || !nullableText(taskSnapshot.completionNote) ||
      (taskSnapshot.committedHandoffVersion !== null && (!Number.isInteger(taskSnapshot.committedHandoffVersion) || (taskSnapshot.committedHandoffVersion as number) < 1))) {
    throw new CheckpointSchemaError("任务要求快照无效");
  }
  if (typeof session.provider !== "string" || typeof session.providerVersion !== "string" ||
      (session.sessionId !== null && typeof session.sessionId !== "string") ||
      (session.checkpointId !== null && typeof session.checkpointId !== "string") ||
      !["native", "context-only"].includes(text(session.captureMode))) {
    throw new CheckpointSchemaError("会话来源信息无效");
  }
  if (!text(handoff.goal) || !text(handoff.nextAction) ||
      (handoff.blocker !== null && typeof handoff.blocker !== "string") ||
      !stringArray(handoff.completed) || !stringArray(handoff.remaining) || !stringArray(handoff.rejectedApproaches)) {
    throw new CheckpointSchemaError("交接内容无效");
  }
  if (!Array.isArray(value.tests) || !Array.isArray(value.artifacts) || value.artifacts.length > 20) throw new CheckpointSchemaError("检查点材料列表无效");
  const tests = value.tests.map((item) => {
    if (!record(item) || typeof item.exitCode !== "number" && item.exitCode !== null ||
        !text(item.command) || !validIso(item.recordedAt) || !["captured", "user-reported"].includes(text(item.source))) {
      throw new CheckpointSchemaError("测试记录无效");
    }
    return { command: text(item.command), exitCode: item.exitCode as number | null, recordedAt: text(item.recordedAt), source: item.source as "captured" | "user-reported" };
  });
  const artifacts = value.artifacts.map((item) => {
    if (!record(item) || !UUID.test(text(item.id)) || !["transcript", "context"].includes(text(item.kind)) ||
        !Number.isSafeInteger(item.byteLength) || (item.byteLength as number) < 0 || !HASH.test(text(item.sha256))) {
      throw new CheckpointSchemaError("检查点附件信息无效");
    }
    const extension = item.kind === "transcript" ? "transcript" : "json";
    if (item.relativePath !== `artifacts/${item.id}.${extension}`) throw new CheckpointSchemaError("检查点附件路径无效");
    return { id: text(item.id), kind: item.kind as "transcript" | "context", relativePath: text(item.relativePath), byteLength: item.byteLength as number, sha256: text(item.sha256) };
  });
  if (new Set(artifacts.map((item) => item.id)).size !== artifacts.length ||
      new Set(artifacts.map((item) => item.relativePath)).size !== artifacts.length) {
    throw new CheckpointSchemaError("检查点附件 ID 或路径重复");
  }
  return {
    schemaVersion: 1,
    id: text(value.id),
    parentCheckpointId: value.parentCheckpointId as string | null,
    serverOrigin: text(value.serverOrigin), projectId: text(value.projectId), taskId: text(value.taskId),
    milestoneId: typeof value.milestoneId === "string" ? value.milestoneId : null,
    capturedAt: text(value.capturedAt), handoffVersion: value.handoffVersion as number, taskUpdatedAt: text(value.taskUpdatedAt),
    taskSnapshot: {
      title: text(taskSnapshot.title), status: text(taskSnapshot.status), priority: text(taskSnapshot.priority),
      dueDate: (taskSnapshot.dueDate ?? null) as string | null,
      assigneeId: taskSnapshot.assigneeId as string | null, assigneeName: taskSnapshot.assigneeName as string | null,
      description: taskSnapshot.description as string | null, handoffBrief: taskSnapshot.handoffBrief as string | null,
      doneCriteria: taskSnapshot.doneCriteria as string[], requiredEvidence: taskSnapshot.requiredEvidence as string[],
      responseDueAt: taskSnapshot.responseDueAt as string | null, completionNote: taskSnapshot.completionNote as string | null,
      committedHandoffVersion: taskSnapshot.committedHandoffVersion as number | null,
    },
    repository: {
      key: text(repository.key), headSha: text(repository.headSha), branch: typeof repository.branch === "string" ? repository.branch : null,
      dirty: repository.dirty as boolean, dirtyPolicy: repository.dirtyPolicy as "clean-only" | "excluded",
      recoveryBlockers: repository.recoveryBlockers as string[],
    },
    session: {
      provider: text(session.provider), providerVersion: text(session.providerVersion),
      sessionId: session.sessionId as string | null, checkpointId: session.checkpointId as string | null,
      captureMode: session.captureMode as "native" | "context-only",
    },
    handoff: {
      goal: text(handoff.goal), completed: handoff.completed as string[], remaining: handoff.remaining as string[],
      blocker: handoff.blocker as string | null, rejectedApproaches: handoff.rejectedApproaches as string[], nextAction: text(handoff.nextAction),
    },
    tests, artifacts,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown): boolean { return value === null || typeof value === "string"; }

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validIso(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validServerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
