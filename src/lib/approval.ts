import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalRequests,
  type ApprovalRequestStatus,
  type ApprovalRequestTool,
  conversations,
  users,
} from "@/db/schema";
import { getConversationForUser } from "@/lib/agent/conversation";
import { commitDraft } from "@/lib/agent/commit";
import { listProjectTasks } from "@/lib/task";
import type { DraftEnvelope } from "@/lib/agent/tools";
import { getProjectForUser } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";

const TITLES: Record<ApprovalRequestTool, string> = {
  create_project: "创建项目",
  decompose_tasks: "拆解任务",
  update_tasks: "批量变更任务",
  plan_sprint: "排期任务",
  create_milestone: "创建里程碑",
  create_decision: "提出决策",
};

export const APPROVAL_EXECUTION_LEASE_MS = 5 * 60 * 1000;

const APPROVAL_ROLES: Record<ApprovalRequestTool, readonly ("admin" | "teacher" | "student")[]> = {
  create_project: ["admin"],
  create_milestone: ["admin"],
  decompose_tasks: ["admin", "student"],
  update_tasks: ["admin", "student"],
  plan_sprint: ["admin", "student"],
  create_decision: ["admin", "teacher", "student"],
};

export type PersistedDraft = DraftEnvelope & {
  approvalId?: string;
  approvalStatus?: ApprovalRequestStatus;
};

export type ApprovalListItem = {
  id: string;
  projectId: string;
  tool: ApprovalRequestTool;
  status: ApprovalRequestStatus;
  title: string;
  payload: unknown;
  result: unknown;
  error: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  resolvedById: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  resolutionNote: string | null;
  ordinal: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  executedAt: Date | null;
  canResolve: boolean;
  permissionReason: string | null;
};

function asApprovalTool(tool: string): ApprovalRequestTool {
  if (!(tool in TITLES)) throw new AppError("未知的 AI 写操作");
  return tool as ApprovalRequestTool;
}

function policyForRole(role: "admin" | "teacher" | "student", tool: ApprovalRequestTool) {
  if (APPROVAL_ROLES[tool].includes(role)) {
    return { canResolve: true, permissionReason: null };
  }
  const hint = tool === "create_project" || tool === "create_milestone" ? "只有组长可以确认" : "教师只能确认决策类 AI 动作";
  return { canResolve: false, permissionReason: hint };
}

/**
 * 从模型工具轨迹中提取草案。这个小函数让历史消息、实时响应和测试
 * 使用同一套识别逻辑，避免客户端自己猜 toolResult 的内部形状。
 */
export function extractDraftsFromToolCalls(toolCalls: unknown): DraftEnvelope[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((trace) => (trace && typeof trace === "object" ? (trace as { output?: unknown }).output : null))
    .filter(
      (output): output is DraftEnvelope =>
        Boolean(
          output &&
            typeof output === "object" &&
            (output as { __draft?: unknown }).__draft === true &&
            typeof (output as { tool?: unknown }).tool === "string" &&
            (output as { draft?: unknown }).draft !== undefined,
        ),
    );
}

export async function createApprovalRequests(
  actorId: string,
  projectId: string,
  sourceConversationId: string,
  sourceMessageId: string,
  drafts: DraftEnvelope[],
) {
  if (drafts.length === 0) return [];
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const conversation = await getConversationForUser(actorId, sourceConversationId);
  if (conversation.projectId !== projectId) throw new ForbiddenError();

  const values = drafts.map((draft, ordinal) => {
    const tool = asApprovalTool(draft.tool);
    return {
      projectId,
      tool,
      title: TITLES[tool],
      payload: draft.draft === undefined ? {} : draft.draft,
      requestedById: actorId,
      sourceConversationId,
      sourceMessageId,
      ordinal,
      idempotencyKey: `${sourceMessageId}:${tool}:${ordinal}`,
    };
  });

  await db.insert(approvalRequests).values(values).onConflictDoNothing({
    target: approvalRequests.idempotencyKey,
  });

  return db
    .select()
    .from(approvalRequests)
    .where(inArray(approvalRequests.idempotencyKey, values.map((value) => value.idempotencyKey)))
    .orderBy(asc(approvalRequests.ordinal));
}

export async function listApprovalRequests(
  actorId: string,
  projectId: string,
  status?: ApprovalRequestStatus,
): Promise<ApprovalListItem[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const rows = await db
    .select({
      id: approvalRequests.id,
      projectId: approvalRequests.projectId,
      tool: approvalRequests.tool,
      status: approvalRequests.status,
      title: approvalRequests.title,
      payload: approvalRequests.payload,
      result: approvalRequests.result,
      error: approvalRequests.error,
      requestedById: approvalRequests.requestedById,
      requestedByName: users.name,
      resolvedById: approvalRequests.resolvedById,
      sourceConversationId: approvalRequests.sourceConversationId,
      sourceMessageId: approvalRequests.sourceMessageId,
      resolutionNote: approvalRequests.resolutionNote,
      ordinal: approvalRequests.ordinal,
      createdAt: approvalRequests.createdAt,
      updatedAt: approvalRequests.updatedAt,
      resolvedAt: approvalRequests.resolvedAt,
      executedAt: approvalRequests.executedAt,
    })
    .from(approvalRequests)
    .leftJoin(users, eq(approvalRequests.requestedById, users.id))
    .where(
      and(
        eq(approvalRequests.projectId, projectId),
        ...(status ? [eq(approvalRequests.status, status)] : []),
      ),
    )
    .orderBy(desc(approvalRequests.createdAt), asc(approvalRequests.ordinal));

  const sourceIds = rows.flatMap((row) => (row.sourceConversationId ? [row.sourceConversationId] : []));
  const visibleSources = sourceIds.length
    ? await db
        .select({ id: conversations.id, createdById: conversations.createdById, visibility: conversations.visibility })
        .from(conversations)
        .where(inArray(conversations.id, sourceIds))
    : [];
  const sourceById = new Map(visibleSources.map((source) => [source.id, source]));
  const withPolicy = rows.map((row) => ({ ...row, ...policyForRole(access.role, row.tool) }));
  return withPolicy.filter((row) => {
    if (!row.sourceConversationId) return true;
    const source = sourceById.get(row.sourceConversationId);
    return !source || source.visibility === "project" || source.createdById === actorId;
  });
}

export async function getApprovalRequestForUser(actorId: string, approvalId: string) {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, approvalId))
    .limit(1);
  if (!row) throw new AppError("审批请求不存在");
  const access = await getProjectForUser(actorId, row.projectId);
  if (!access) throw new ForbiddenError();
  if (row.sourceConversationId) await getConversationForUser(actorId, row.sourceConversationId);
  return row;
}

async function assertCanResolve(actorId: string, projectId: string, tool: ApprovalRequestTool) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const policy = policyForRole(access.role, tool);
  if (!policy.canResolve) throw new ForbiddenError(policy.permissionReason ?? "没有确认权限");
  return access;
}

export async function previewApproval(actorId: string, approvalId: string) {
  const request = await getApprovalRequestForUser(actorId, approvalId);
  if (request.tool !== "update_tasks") {
    return { tool: request.tool, staleCount: 0, rows: [] as const };
  }
  const payload = request.payload && typeof request.payload === "object" ? request.payload as { updates?: unknown } : {};
  const updates = Array.isArray(payload.updates) ? payload.updates : [];
  const current = await listProjectTasks(actorId, request.projectId);
  const currentById = new Map(current.map((task) => [task.id, task]));
  const rows = updates.map((item) => {
    const update = item && typeof item === "object" ? item as { taskId?: unknown; updatedAt?: unknown; patch?: unknown } : {};
    const taskId = typeof update.taskId === "string" ? update.taskId : null;
    const task = taskId ? currentById.get(taskId) : undefined;
    const expectedUpdatedAt = typeof update.updatedAt === "string" ? update.updatedAt : null;
    const currentUpdatedAt = task?.updatedAt.toISOString() ?? null;
    return {
      taskId,
      title: task?.title ?? "任务不存在或已移出项目",
      expectedUpdatedAt,
      currentUpdatedAt,
      stale: !task || !expectedUpdatedAt || expectedUpdatedAt !== currentUpdatedAt,
      patch: update.patch ?? {},
    };
  });
  return { tool: request.tool, staleCount: rows.filter((row) => row.stale).length, rows };
}

/**
 * 人工确认的唯一执行入口。先用 CAS 抢占 pending，避免双击或两个浏览器
 * 同时执行同一草案；真正写入仍委托给已有的 commitDraft，因此权限、Zod
 * 和乐观锁规则不会在审批层复制一份。
 */
export async function resolveApprovalRequest(
  actorId: string,
  approvalId: string,
  input: { decision: "approve" | "reject"; payload?: unknown; note?: string },
) {
  const request = await getApprovalRequestForUser(actorId, approvalId);
  await assertCanResolve(actorId, request.projectId, request.tool);

  if (input.decision === "reject") {
    const [rejected] = await db
      .update(approvalRequests)
      .set({
        status: "rejected",
        resolutionNote: input.note?.trim() || null,
        resolvedById: actorId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, "pending")))
      .returning();
    if (!rejected) {
      const current = await getApprovalRequestForUser(actorId, approvalId);
      if (current.status === "rejected") return current;
      throw new AppError(`该审批已处于「${current.status}」状态`);
    }
    return rejected;
  }

  const [claimed] = await db
    .update(approvalRequests)
    .set({ status: "executing", resolvedById: actorId, updatedAt: new Date() })
    .where(
      and(
        eq(approvalRequests.id, approvalId),
        or(eq(approvalRequests.status, "pending"), eq(approvalRequests.status, "failed")),
      ),
    )
    .returning();

  if (!claimed) {
    const current = await getApprovalRequestForUser(actorId, approvalId);
    if (current.status === "executed") return current;
    if (current.status === "executing") throw new AppError("这条审批正在执行，请稍候刷新");
    throw new AppError(`该审批已处于「${current.status}」状态`);
  }

  try {
    const result = await commitDraft(
      actorId,
      claimed.projectId,
      claimed.tool,
      input.payload === undefined ? claimed.payload : input.payload,
    );
    const [executed] = await db
      .update(approvalRequests)
      .set({
        status: "executed",
        result,
        error: null,
        resolutionNote: input.note?.trim() || null,
        resolvedAt: new Date(),
        executedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, "executing")))
      .returning();
    return executed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行失败";
    await db
      .update(approvalRequests)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, "executing")));
    throw error;
  }
}

/**
 * 进程在 commitDraft 成功后崩溃时，审批可能停在 executing。这里不自动重放，
 * 而是要求人先核对项目，再把它转为可重试的 failed，避免重复创建任务/里程碑。
 */
export async function recoverStaleApproval(actorId: string, approvalId: string) {
  const request = await getApprovalRequestForUser(actorId, approvalId);
  await assertCanResolve(actorId, request.projectId, request.tool);
  if (request.status !== "executing") throw new AppError("只有执行中的审批可以恢复");
  if (Date.now() - request.updatedAt.getTime() < APPROVAL_EXECUTION_LEASE_MS) {
    throw new AppError("这条审批仍在执行窗口内，请稍候刷新");
  }
  const [recovered] = await db
    .update(approvalRequests)
    .set({
      status: "failed",
      error: "执行超时，业务写入状态未知；请先核对项目，再决定是否重试",
      resolutionNote: "人工将执行中状态转为可核对的失败状态",
      updatedAt: new Date(),
    })
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, "executing")))
    .returning();
  if (!recovered) throw new AppError("审批状态已变化，请刷新后重试");
  return recovered;
}
