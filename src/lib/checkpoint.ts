import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
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
import { AppError, ConflictError, ForbiddenError, NotFoundError, isUniqueViolation } from "./errors";
import { getProjectForUser } from "./project";

export type CreateCheckpointInput = {
  idempotencyKey?: string;
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

function toValidDate(value: string | Date, fieldName: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError(`${fieldName} 无效`);
  return date;
}

function sameHandoffPayload(
  existing: typeof handoffRecords.$inferSelect,
  projectId: string,
  taskId: string,
  input: CreateHandoffInput,
  expectedTaskUpdatedAt: Date,
) {
  return (
    existing.projectId === projectId &&
    existing.taskId === taskId &&
    existing.checkpointId === input.checkpointId &&
    existing.toUserId === input.toUserId &&
    existing.expectedHandoffVersion === input.expectedHandoffVersion &&
    existing.expectedTaskUpdatedAt.getTime() === expectedTaskUpdatedAt.getTime()
  );
}

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

/** Current human recipients for a project-scoped handoff. Never expose email or stale member data. */
export async function listProjectHandoffRecipients(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  return db
    .select({ userId: teamMembers.userId, displayName: users.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(and(eq(teamMembers.teamId, access.project.teamId), eq(users.kind, "human")))
    .orderBy(asc(users.name), asc(users.id));
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

  const taskUpdatedAt = toValidDate(input.taskUpdatedAt, "检查点任务更新时间");
  const normalizedInput = { ...input, visibility: input.visibility ?? "project", taskUpdatedAt };
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(checkpointIndices)
      .where(and(eq(checkpointIndices.creatorId, actorId), eq(checkpointIndices.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (sameCheckpointPayload(existing, projectId, taskId, actorId, normalizedInput)) return existing;
      throw new ConflictError("相同幂等键已用于其他检查点发布请求");
    }
  }

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
  if (taskUpdatedAt.getTime() !== task.updatedAt.getTime()) {
    throw new ConflictError("任务在检查点采集后已更新，请刷新任务并重新保存检查点");
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

  try {
    const [created] = await db
      .insert(checkpointIndices)
      .values({
        projectId,
        taskId,
        creatorId: actorId,
        idempotencyKey: input.idempotencyKey ?? null,
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
  } catch (error) {
    if (!input.idempotencyKey || !isUniqueViolation(error)) throw error;
    const [raced] = await db
      .select()
      .from(checkpointIndices)
      .where(and(eq(checkpointIndices.creatorId, actorId), eq(checkpointIndices.idempotencyKey, input.idempotencyKey)));
    if (!raced) throw error;
    if (sameCheckpointPayload(raced, projectId, taskId, actorId, normalizedInput)) return raced;
    throw new ConflictError("相同幂等键已用于其他检查点发布请求");
  }
}

function sameCheckpointPayload(
  existing: typeof checkpointIndices.$inferSelect,
  projectId: string,
  taskId: string,
  actorId: string,
  input: CreateCheckpointInput & { visibility: "project" | "assignee"; taskUpdatedAt: Date },
): boolean {
  return existing.projectId === projectId && existing.taskId === taskId && existing.creatorId === actorId &&
    existing.visibility === input.visibility && existing.parentCheckpointId === (input.parentCheckpointId ?? null) &&
    existing.taskHandoffVersion === input.taskHandoffVersion && existing.taskUpdatedAt.getTime() === input.taskUpdatedAt.getTime() &&
    existing.repositoryKeyHash === input.repositoryKeyHash && existing.headSha === input.headSha &&
    stableJson(existing.source) === stableJson(input.source) && stableJson(existing.handoffSummary) === stableJson(input.handoffSummary) &&
    stableJson(existing.materials) === stableJson(input.materials);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
  const expectedTaskUpdatedAt = toValidDate(input.expectedTaskUpdatedAt, "任务更新时间");

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
    if (sameHandoffPayload(existing, projectId, taskId, input, expectedTaskUpdatedAt)) {
      return { record: existing, isNew: false };
    }
    throw new ConflictError("相同幂等键已用于其他交接请求");
  }

  try {
    const created = await db.transaction(async (tx) => {
      // The initial project lookup is an early rejection only. Re-check both
      // people at write time because either membership may have changed.
      const memberships = await tx
        .select({ userId: teamMembers.userId, role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, access.project.teamId),
            inArray(teamMembers.userId, [actorId, input.toUserId]),
          ),
        );
      const actorMembership = memberships.find((member) => member.userId === actorId);
      const recipientMembership = memberships.find((member) => member.userId === input.toUserId);
      if (!actorMembership) throw new ForbiddenError("当前用户已不属于该项目团队");
      if (!recipientMembership) throw new AppError("接收人不是该项目团队成员");

      // Serialize against task contract edits so the version checked here is
      // the one this handoff is actually based on.
      const [task] = await tx
        .select({ id: tasks.id, handoffVersion: tasks.handoffVersion, updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
        .for("update");
      if (!task) throw new NotFoundError("任务不存在");
      if (task.handoffVersion !== input.expectedHandoffVersion) {
        throw new ConflictError("任务交接契约版本已变化，当前最新为 v" + task.handoffVersion);
      }
      if (task.updatedAt.getTime() !== expectedTaskUpdatedAt.getTime()) {
        throw new ConflictError("任务已更新，请刷新后重新发起交接");
      }

      const [checkpoint] = await tx
        .select({ id: checkpointIndices.id, creatorId: checkpointIndices.creatorId })
        .from(checkpointIndices)
        .where(
          and(
            eq(checkpointIndices.id, input.checkpointId),
            eq(checkpointIndices.projectId, projectId),
            eq(checkpointIndices.taskId, taskId),
          ),
        );
      if (!checkpoint) throw new NotFoundError("检查点不存在或不匹配此任务");
      if (checkpoint.creatorId !== actorId && actorMembership.role !== "admin") {
        throw new ForbiddenError("只有检查点创建者或管理员可以发起以此检查点为基准的交接");
      }

      const [record] = await tx
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
      return record;
    });
    return { record: created, isNew: true };
  } catch (error) {
    // The unique index remains the final arbiter for concurrent retries.
    if (!isUniqueViolation(error)) throw error;
    const [raced] = await db
      .select()
      .from(handoffRecords)
      .where(
        and(
          eq(handoffRecords.fromUserId, actorId),
          eq(handoffRecords.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (!raced) throw error;
    if (sameHandoffPayload(raced, projectId, taskId, input, expectedTaskUpdatedAt)) {
      return { record: raced, isNew: false };
    }
    throw new ConflictError("相同幂等键已用于其他交接请求");
  }

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
      idempotencyKey: handoffRecords.idempotencyKey,
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
  options: { reason?: string; expectedHandoffVersion: number },
) {
  return db.transaction(async (tx) => {
    const [handoff] = await tx
      .select()
      .from(handoffRecords)
      .where(eq(handoffRecords.id, handoffId))
      .for("update");
    if (!handoff) throw new NotFoundError("交接单不存在");

    const [membership] = await tx
      .select({ role: teamMembers.role })
      .from(projects)
      .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
      .where(and(eq(projects.id, handoff.projectId), eq(teamMembers.userId, actorId)));
    if (!membership) throw new ForbiddenError("当前用户已不属于该项目团队");

    if (handoff.state !== "offered") {
      throw new ConflictError(`交接单当前状态为 ${handoff.state}，无法执行 ${action}`);
    }
    if (handoff.expectedHandoffVersion !== options.expectedHandoffVersion) {
      throw new ConflictError("交接单版本已变化，请刷新后重试");
    }

    if (action === "accept" || action === "decline") {
      if (handoff.toUserId !== actorId) {
        throw new ForbiddenError(`只有指定接收人可以${action === "accept" ? "接收" : "拒绝"}此交接单`);
      }
    } else if (action === "withdraw") {
      if (handoff.fromUserId !== actorId) {
        throw new ForbiddenError("只有发起人可以撤回此交接单");
      }
    } else {
      throw new AppError("未知的交接处理动作");
    }

    if (action === "accept") {
      // Hold the task row while comparing its live contract version; a contract
      // update cannot slip between this check and the state transition.
      const [task] = await tx
        .select({ handoffVersion: tasks.handoffVersion })
        .from(tasks)
        .where(eq(tasks.id, handoff.taskId))
        .for("update");
      if (!task) throw new NotFoundError("关联任务不存在");
      if (task.handoffVersion !== handoff.expectedHandoffVersion) {
        throw new ConflictError("任务契约已更新，原有交接单已失效，请发起方重新交接");
      }
    }

    const nextState = action === "accept" ? "accepted" : action === "decline" ? "declined" : "withdrawn";
    const [updated] = await tx
      .update(handoffRecords)
      .set({
        state: nextState,
        reason: action === "accept" ? handoff.reason : options.reason ?? null,
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(handoffRecords.id, handoffId),
          eq(handoffRecords.state, "offered"),
          eq(handoffRecords.expectedHandoffVersion, options.expectedHandoffVersion),
        ),
      )
      .returning();
    if (!updated) throw new ConflictError("交接单状态或版本已变化，请刷新后重试");
    return updated;
  });
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

export type PreflightCheckInput = {
  clientHeadSha?: string;
  clientRepoKeyHash?: string;
  clientDirty?: boolean;
};

/** B03: 接班核对 (Handover Preflight) 服务端评估 */
export async function evaluateServerHandoffPreflight(
  actorId: string,
  handoffId: string,
  client?: PreflightCheckInput,
) {
  const handoff = await getHandoff(actorId, handoffId);
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, handoff.taskId));

  if (!task) throw new NotFoundError("关联任务不存在");

  const blockers: string[] = [];
  const warnings: string[] = [];
  const changes: Array<{ field: string; expected: unknown; current: unknown }> = [];

  if (handoff.state === "declined" || handoff.state === "withdrawn" || handoff.state === "superseded") {
    blockers.push(`交接单状态为 ${handoff.state}，不能接班继续`);
  }

  if (task.status === "done") {
    blockers.push("任务已验收完成，不能继续接班");
  }

  if (task.handoffVersion !== handoff.expectedHandoffVersion) {
    blockers.push(`任务交接契约已更新（当前 v${task.handoffVersion}，交接预期 v${handoff.expectedHandoffVersion}）`);
    changes.push({
      field: "交接契约版本",
      expected: `v${handoff.expectedHandoffVersion}`,
      current: `v${task.handoffVersion}`,
    });
  }

  if (client?.clientRepoKeyHash && handoff.checkpoint?.repositoryKeyHash) {
    if (client.clientRepoKeyHash !== handoff.checkpoint.repositoryKeyHash) {
      blockers.push("客户端仓库哈希与检查点记录的仓库标识不匹配");
    }
  }

  if (client?.clientHeadSha && handoff.checkpoint?.headSha) {
    if (client.clientHeadSha !== handoff.checkpoint.headSha) {
      blockers.push(`客户端 Git HEAD (${client.clientHeadSha.slice(0, 8)}) 与检查点基线 (${handoff.checkpoint.headSha.slice(0, 8)}) 不一致`);
    }
  }

  if (client?.clientDirty) {
    blockers.push("客户端当前工作区有未提交或未跟踪改动");
  }

  const isBlocked = blockers.length > 0;
  const needsConfirm = changes.length > 0 && !isBlocked;

  return {
    ok: !isBlocked && !needsConfirm,
    status: (isBlocked ? "blocked" : needsConfirm ? "needs-confirmation" : "ready") as
      | "blocked"
      | "needs-confirmation"
      | "ready",
    blockers,
    warnings,
    changes,
    contract: {
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
      currentHandoffVersion: task.handoffVersion,
      expectedHandoffVersion: handoff.expectedHandoffVersion,
      baseSha: handoff.checkpoint?.headSha ?? null,
      materialsCount: handoff.checkpoint?.materials?.length ?? 0,
    },
  };
}

/** B04: 查询指定任务下的所有 Attempt 执行记录（支持同源并行方案比对） */
export async function listTaskAttempts(
  actorId: string,
  projectId: string,
  taskId: string,
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

  if (!task) throw new NotFoundError("任务不存在或不属于该项目");

  const rows = await db
    .select({
      id: attemptReceipts.id,
      handoffId: attemptReceipts.handoffId,
      checkpointId: attemptReceipts.checkpointId,
      taskId: attemptReceipts.taskId,
      actorId: attemptReceipts.actorId,
      actorName: users.name,
      baseSha: attemptReceipts.baseSha,
      branchName: attemptReceipts.branchName,
      kind: attemptReceipts.kind,
      provider: attemptReceipts.provider,
      providerVersion: attemptReceipts.providerVersion,
      state: attemptReceipts.state,
      receipt: attemptReceipts.receipt,
      createdAt: attemptReceipts.createdAt,
      updatedAt: attemptReceipts.updatedAt,
    })
    .from(attemptReceipts)
    .leftJoin(users, eq(attemptReceipts.actorId, users.id))
    .where(eq(attemptReceipts.taskId, taskId))
    .orderBy(desc(attemptReceipts.createdAt));

  return rows;
}
