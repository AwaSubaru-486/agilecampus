import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  checkpointIndices,
  handoffRecords,
  attemptReceipts,
  projects,
  tasks,
  users,
  teamMembers,
  type CheckpointMaterial,
  type CheckpointSource,
  type CheckpointSummary,
  type HandoffState,
  type AttemptKind,
  type AttemptState,
  type AttemptReceipt,
} from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { getProjectForUser } from "./project";
import { getTeamMembership } from "./team";

export type CreateCheckpointInput = {
  visibility?: "project" | "assignee";
  parentCheckpointId?: string | null;
  taskHandoffVersion: number;
  taskUpdatedAt: string | Date;
  repositoryKeyHash: string;
  headSha: string;
  source: CheckpointSource;
  handoffSummary: CheckpointSummary;
  materials: CheckpointMaterial[];
};

export type CreateHandoffInput = {
  checkpointId: string;
  toUserId: string;
  expectedTaskUpdatedAt: string | Date;
  expectedHandoffVersion: number;
  idempotencyKey: string;
};

export type CreateAttemptInput = {
  baseSha: string;
  branchName?: string | null;
  kind?: AttemptKind;
  provider?: string;
  providerVersion?: string;
  receipt?: AttemptReceipt;
};

export type UpdateAttemptInput = {
  state?: AttemptState;
  receipt?: Partial<AttemptReceipt>;
};

// 游标编解码辅助
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const [dateStr, id] = raw.split("|");
    if (!dateStr || !id) return null;
    const createdAt = new Date(dateStr);
    if (isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** 扩展身份探测：返回 actor 身份与当前项目成员关系 */
export async function getActorProfile(actorId: string) {
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, actorId));
  if (!user) throw new NotFoundError("用户不存在");

  const memberships = await db
    .select({
      teamId: teamMembers.teamId,
      role: teamMembers.role,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(teamMembers)
    .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
    .where(eq(teamMembers.userId, actorId));

  return {
    actor: {
      id: user.id,
      displayName: user.name,
      email: user.email,
    },
    memberships: memberships.map((m) => ({
      projectId: m.projectId,
      projectName: m.projectName,
      teamId: m.teamId,
      role: m.role,
    })),
    capabilities: {
      checkpointRead: true,
      checkpointCreate: true,
      handoffOffer: true,
      handoffReceive: true,
    },
  };
}

/** 创建检查点索引 */
export async function createCheckpoint(
  actorId: string,
  projectId: string,
  taskId: string,
  input: CreateCheckpointInput,
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const [task] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      handoffVersion: tasks.handoffVersion,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

  if (!task) throw new NotFoundError("任务不存在或不属于该项目");

  if (input.taskHandoffVersion !== task.handoffVersion) {
    throw new ConflictError("任务交接契约版本已更新，当前最新为 v" + task.handoffVersion);
  }

  if (input.parentCheckpointId) {
    const [parent] = await db
      .select({ id: checkpointIndices.id })
      .from(checkpointIndices)
      .where(
        and(
          eq(checkpointIndices.id, input.parentCheckpointId),
          eq(checkpointIndices.projectId, projectId),
          eq(checkpointIndices.taskId, taskId),
        ),
      );
    if (!parent) throw new NotFoundError("父检查点不存在或不匹配");
  }

  // 材料与摘要大小硬限制（E09 规范）
  if (input.materials.length > 20) {
    throw new AppError("检查点附件数量不能超过 20 项");
  }
  let totalBytes = 0;
  for (const mat of input.materials) {
    if (mat.byteLength > 5 * 1024 * 1024) throw new AppError("单个附件不能超过 5 MiB");
    totalBytes += mat.byteLength;
  }
  if (totalBytes > 10 * 1024 * 1024) throw new AppError("附件总量不能超过 10 MiB");

  const taskUpdatedAt =
    input.taskUpdatedAt instanceof Date ? input.taskUpdatedAt : new Date(input.taskUpdatedAt);

  const [created] = await db
    .insert(checkpointIndices)
    .values({
      projectId,
      taskId,
      creatorId: actorId,
      visibility: input.visibility ?? "project",
      parentCheckpointId: input.parentCheckpointId ?? null,
      taskHandoffVersion: input.taskHandoffVersion,
      taskUpdatedAt,
      repositoryKeyHash: input.repositoryKeyHash,
      headSha: input.headSha,
      source: input.source,
      handoffSummary: input.handoffSummary,
      materials: input.materials,
    })
    .returning();

  return created;
}

/** 分页列出项目检查点 */
export async function listCheckpoints(
  actorId: string,
  projectId: string,
  taskId?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const limit = Math.min(Math.max(options.limit ?? 30, 1), 50);
  const parsedCursor = options.cursor ? decodeCursor(options.cursor) : null;

  const conditions = [
    eq(checkpointIndices.projectId, projectId),
    taskId ? eq(checkpointIndices.taskId, taskId) : undefined,
    or(
      eq(checkpointIndices.visibility, "project"),
      eq(checkpointIndices.creatorId, actorId),
    ),
    parsedCursor
      ? sql`(${checkpointIndices.createdAt}, ${checkpointIndices.id}) < (${parsedCursor.createdAt.toISOString()}::timestamptz, ${parsedCursor.id}::uuid)`
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: checkpointIndices.id,
      projectId: checkpointIndices.projectId,
      taskId: checkpointIndices.taskId,
      creatorId: checkpointIndices.creatorId,
      creatorName: users.name,
      visibility: checkpointIndices.visibility,
      parentCheckpointId: checkpointIndices.parentCheckpointId,
      taskHandoffVersion: checkpointIndices.taskHandoffVersion,
      taskUpdatedAt: checkpointIndices.taskUpdatedAt,
      repositoryKeyHash: checkpointIndices.repositoryKeyHash,
      headSha: checkpointIndices.headSha,
      source: checkpointIndices.source,
      handoffSummary: checkpointIndices.handoffSummary,
      materialsCount: sql<number>`jsonb_array_length(${checkpointIndices.materials})::int`,
      createdAt: checkpointIndices.createdAt,
    })
    .from(checkpointIndices)
    .leftJoin(users, eq(checkpointIndices.creatorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(checkpointIndices.createdAt), desc(checkpointIndices.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

  return {
    items,
    hasMore,
    nextCursor,
  };
}

/** 获取单个检查点详情 */
export async function getCheckpoint(actorId: string, checkpointId: string) {
  const [checkpoint] = await db
    .select({
      id: checkpointIndices.id,
      projectId: checkpointIndices.projectId,
      taskId: checkpointIndices.taskId,
      creatorId: checkpointIndices.creatorId,
      creatorName: users.name,
      visibility: checkpointIndices.visibility,
      parentCheckpointId: checkpointIndices.parentCheckpointId,
      taskHandoffVersion: checkpointIndices.taskHandoffVersion,
      taskUpdatedAt: checkpointIndices.taskUpdatedAt,
      repositoryKeyHash: checkpointIndices.repositoryKeyHash,
      headSha: checkpointIndices.headSha,
      source: checkpointIndices.source,
      handoffSummary: checkpointIndices.handoffSummary,
      materials: checkpointIndices.materials,
      createdAt: checkpointIndices.createdAt,
    })
    .from(checkpointIndices)
    .leftJoin(users, eq(checkpointIndices.creatorId, users.id))
    .where(eq(checkpointIndices.id, checkpointId));

  if (!checkpoint) throw new NotFoundError("检查点不存在");

  const access = await getProjectForUser(actorId, checkpoint.projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  if (checkpoint.visibility === "assignee" && checkpoint.creatorId !== actorId) {
    const [task] = await db
      .select({ assigneeId: tasks.assigneeId })
      .from(tasks)
      .where(eq(tasks.id, checkpoint.taskId));
    if (task?.assigneeId !== actorId && access.role !== "admin") {
      throw new ForbiddenError("该检查点仅限指定接收人查看");
    }
  }

  return checkpoint;
}

/** 发起交接单 */
export async function createHandoff(
  actorId: string,
  projectId: string,
  taskId: string,
  input: CreateHandoffInput,
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  // 幂等校验
  const [existing] = await db
    .select()
    .from(handoffRecords)
    .where(
      and(
        eq(handoffRecords.fromUserId, actorId),
        eq(handoffRecords.idempotencyKey, input.idempotencyKey),
      ),
    );

  if (existing) {
    if (
      existing.checkpointId === input.checkpointId &&
      existing.toUserId === input.toUserId &&
      existing.taskId === taskId
    ) {
      return { record: existing, isNew: false };
    }
    throw new ConflictError("相同幂等键已用于其他交接请求");
  }

  // 接收方同团队验证
  const recipientMembership = await getTeamMembership(input.toUserId, access.project.teamId);
  if (!recipientMembership) throw new AppError("接收人不是该项目团队成员");

  const [task] = await db
    .select({
      id: tasks.id,
      handoffVersion: tasks.handoffVersion,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

  if (!task) throw new NotFoundError("任务不存在");
  if (task.handoffVersion !== input.expectedHandoffVersion) {
    throw new ConflictError("任务交接契约版本已变化，当前最新为 v" + task.handoffVersion);
  }

  const [checkpoint] = await db
    .select({
      id: checkpointIndices.id,
      creatorId: checkpointIndices.creatorId,
    })
    .from(checkpointIndices)
    .where(
      and(
        eq(checkpointIndices.id, input.checkpointId),
        eq(checkpointIndices.projectId, projectId),
        eq(checkpointIndices.taskId, taskId),
      ),
    );

  if (!checkpoint) throw new NotFoundError("检查点不存在或不匹配此任务");
  if (checkpoint.creatorId !== actorId && access.role !== "admin") {
    throw new ForbiddenError("只有检查点创建者或管理员可以发起以此检查点为基准的交接");
  }

  const expectedTaskUpdatedAt =
    input.expectedTaskUpdatedAt instanceof Date
      ? input.expectedTaskUpdatedAt
      : new Date(input.expectedTaskUpdatedAt);

  const [created] = await db
    .insert(handoffRecords)
    .values({
      projectId,
      taskId,
      checkpointId: input.checkpointId,
      fromUserId: actorId,
      toUserId: input.toUserId,
      expectedTaskUpdatedAt,
      expectedHandoffVersion: input.expectedHandoffVersion,
      state: "offered",
      idempotencyKey: input.idempotencyKey,
    })
    .returning();

  return { record: created, isNew: true };

}

/** 分页查询交接单 */
export async function listHandoffs(
  actorId: string,
  options: {
    projectId?: string;
    state?: HandoffState;
    box?: "inbox" | "outbox" | "all";
    cursor?: string;
    limit?: number;
  } = {},
) {
  const box = options.box ?? "inbox";
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 50);
  const parsedCursor = options.cursor ? decodeCursor(options.cursor) : null;

  const boxCondition =
    box === "inbox"
      ? eq(handoffRecords.toUserId, actorId)
      : box === "outbox"
        ? eq(handoffRecords.fromUserId, actorId)
        : or(eq(handoffRecords.toUserId, actorId), eq(handoffRecords.fromUserId, actorId));

  const conditions = [
    boxCondition,
    options.projectId ? eq(handoffRecords.projectId, options.projectId) : undefined,
    options.state ? eq(handoffRecords.state, options.state) : undefined,
    parsedCursor
      ? sql`(${handoffRecords.createdAt}, ${handoffRecords.id}) < (${parsedCursor.createdAt.toISOString()}::timestamptz, ${parsedCursor.id}::uuid)`
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: handoffRecords.id,
      projectId: handoffRecords.projectId,
      projectName: projects.name,
      taskId: handoffRecords.taskId,
      taskTitle: tasks.title,
      checkpointId: handoffRecords.checkpointId,
      fromUserId: handoffRecords.fromUserId,
      toUserId: handoffRecords.toUserId,
      expectedHandoffVersion: handoffRecords.expectedHandoffVersion,
      state: handoffRecords.state,
      reason: handoffRecords.reason,
      createdAt: handoffRecords.createdAt,
      resolvedAt: handoffRecords.resolvedAt,
    })
    .from(handoffRecords)
    .innerJoin(projects, eq(handoffRecords.projectId, projects.id))
    .innerJoin(tasks, eq(handoffRecords.taskId, tasks.id))
    .where(and(...conditions))
    .orderBy(desc(handoffRecords.createdAt), desc(handoffRecords.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

  return {
    items,
    hasMore,
    nextCursor,
  };
}

/** 查看单个交接单详情 */
export async function getHandoff(actorId: string, handoffId: string) {
  const [handoff] = await db
    .select({
      id: handoffRecords.id,
      projectId: handoffRecords.projectId,
      taskId: handoffRecords.taskId,
      checkpointId: handoffRecords.checkpointId,
      fromUserId: handoffRecords.fromUserId,
      toUserId: handoffRecords.toUserId,
      expectedTaskUpdatedAt: handoffRecords.expectedTaskUpdatedAt,
      expectedHandoffVersion: handoffRecords.expectedHandoffVersion,
      state: handoffRecords.state,
      reason: handoffRecords.reason,
      createdAt: handoffRecords.createdAt,
      resolvedAt: handoffRecords.resolvedAt,
    })
    .from(handoffRecords)
    .where(eq(handoffRecords.id, handoffId));

  if (!handoff) throw new NotFoundError("交接单不存在");

  const access = await getProjectForUser(actorId, handoff.projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  if (
    handoff.fromUserId !== actorId &&
    handoff.toUserId !== actorId &&
    access.role !== "admin"
  ) {
    throw new ForbiddenError("无权查看该交接单");
  }

  const [checkpoint] = await db
    .select({
      headSha: checkpointIndices.headSha,
      repositoryKeyHash: checkpointIndices.repositoryKeyHash,
      handoffSummary: checkpointIndices.handoffSummary,
      source: checkpointIndices.source,
      materials: checkpointIndices.materials,
    })
    .from(checkpointIndices)
    .where(eq(checkpointIndices.id, handoff.checkpointId));

  return {
    ...handoff,
    checkpoint: checkpoint ?? null,
  };
}

/** 接收、拒绝或撤回交接单 */
export async function resolveHandoff(
  actorId: string,
  handoffId: string,
  action: "accept" | "decline" | "withdraw",
  options: { reason?: string; expectedHandoffVersion?: number } = {},
) {
  const [handoff] = await db
    .select()
    .from(handoffRecords)
    .where(eq(handoffRecords.id, handoffId));

  if (!handoff) throw new NotFoundError("交接单不存在");

  if (handoff.state !== "offered") {
    throw new ConflictError(`交接单当前状态为 ${handoff.state}，无法执行 ${action}`);
  }

  const now = new Date();

  if (action === "accept") {
    if (handoff.toUserId !== actorId) {
      throw new ForbiddenError("只有指定接收人可以接收此交接单");
    }
    // 核对当前任务契约版本
    const [task] = await db
      .select({ handoffVersion: tasks.handoffVersion })
      .from(tasks)
      .where(eq(tasks.id, handoff.taskId));
    if (task && task.handoffVersion !== handoff.expectedHandoffVersion) {
      throw new ConflictError("任务契约已更新，原有交接单已失效，请发起方重新交接");
    }

    const [updated] = await db
      .update(handoffRecords)
      .set({
        state: "accepted",
        resolvedAt: now,
      })
      .where(eq(handoffRecords.id, handoffId))
      .returning();
    return updated;
  }

  if (action === "decline") {
    if (handoff.toUserId !== actorId) {
      throw new ForbiddenError("只有指定接收人可以拒绝此交接单");
    }
    const [updated] = await db
      .update(handoffRecords)
      .set({
        state: "declined",
        reason: options.reason ?? null,
        resolvedAt: now,
      })
      .where(eq(handoffRecords.id, handoffId))
      .returning();
    return updated;
  }

  if (action === "withdraw") {
    if (handoff.fromUserId !== actorId) {
      throw new ForbiddenError("只有发起人可以撤回此交接单");
    }
    const [updated] = await db
      .update(handoffRecords)
      .set({
        state: "withdrawn",
        reason: options.reason ?? null,
        resolvedAt: now,
      })
      .where(eq(handoffRecords.id, handoffId))
      .returning();
    return updated;
  }

  throw new AppError("未知的交接处理动作");
}

/** 登记 Attempt 执行回执 */
export async function createAttempt(
  actorId: string,
  handoffId: string,
  input: CreateAttemptInput,
) {
  const [handoff] = await db
    .select()
    .from(handoffRecords)
    .where(eq(handoffRecords.id, handoffId));

  if (!handoff) throw new NotFoundError("交接单不存在");
  if (handoff.state !== "accepted") {
    throw new ConflictError("只有已被接受的交接单才能创建 Attempt 执行记录");
  }

  if (handoff.toUserId !== actorId) {
    const access = await getProjectForUser(actorId, handoff.projectId);
    if (access?.role !== "admin") {
      throw new ForbiddenError("只有交接接收人可以创建 Attempt");
    }
  }

  // 严格核对 baseSha 必须精确等于 Checkpoint headSha (E09 规范)
  const [checkpoint] = await db
    .select({ headSha: checkpointIndices.headSha })
    .from(checkpointIndices)
    .where(eq(checkpointIndices.id, handoff.checkpointId));

  if (!checkpoint) throw new NotFoundError("检查点不存在");
  if (input.baseSha.trim() !== checkpoint.headSha.trim()) {
    throw new ConflictError(`Attempt base SHA (${input.baseSha}) 必须与 Checkpoint head SHA (${checkpoint.headSha}) 完全一致`);
  }

  const defaultReceipt: AttemptReceipt = {
    sessionId: null,
    headSha: null,
    changedPaths: [],
    tests: [],
  };

  const [attempt] = await db
    .insert(attemptReceipts)
    .values({
      handoffId,
      checkpointId: handoff.checkpointId,
      taskId: handoff.taskId,
      actorId,
      baseSha: input.baseSha,
      branchName: input.branchName ?? null,
      kind: input.kind ?? "continuation",
      provider: input.provider ?? "codex-cli",
      providerVersion: input.providerVersion ?? "1.0.0",
      state: "started",
      receipt: input.receipt ?? defaultReceipt,
    })
    .returning();

  return attempt;
}

/** 更新 Attempt 回执与状态 */
export async function updateAttempt(
  actorId: string,
  attemptId: string,
  input: UpdateAttemptInput,
) {
  const [attempt] = await db
    .select()
    .from(attemptReceipts)
    .where(eq(attemptReceipts.id, attemptId));

  if (!attempt) throw new NotFoundError("Attempt 记录不存在");
  if (attempt.actorId !== actorId) {
    throw new ForbiddenError("只有该 Attempt 的执行人可以更新其回执");
  }

  const updatedReceipt: AttemptReceipt = {
    ...attempt.receipt,
    ...(input.receipt ?? {}),
  };

  const [updated] = await db
    .update(attemptReceipts)
    .set({
      state: input.state ?? attempt.state,
      receipt: updatedReceipt,
      updatedAt: new Date(),
    })
    .where(eq(attemptReceipts.id, attemptId))
    .returning();

  return updated;
}
