import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityEvents, agentRuns, blockers, contextPacks, tasks, users } from "@/db/schema";
import { getProjectForUser } from "./project";
import { AppError, ForbiddenError } from "./errors";
import { getTaskDetail } from "./task";
import { listTaskEvidence } from "./evidence";
import { getContextPackForUser } from "./context-pack";
import { listApprovalRequests } from "./approval";
import { getConversationForUser, listConversationMessages } from "./agent/conversation";
import { toTaskRowModel } from "./collaboration-console-view";

// Server-side read model. Never import this module into a client component.
const uuid = z.string().uuid();
const inaccessible = () => new ForbiddenError("记录不存在或无权访问");
const cursorSchema = z.object({ scope: z.string(), id: uuid });
type PageOptions = { cursor?: string; limit?: number };

function pageSize(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new AppError("分页大小必须为 1–100");
  return value;
}

function cursorId(cursor: string | undefined, scope: string) {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 1024) throw new Error();
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.scope !== scope) throw new Error();
    return parsed.id;
  } catch { throw new AppError("分页游标无效"); }
}

function page<T extends { id: string }>(rows: T[], limit: number, scope: string) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { items, hasMore, nextCursor: hasMore
    ? Buffer.from(JSON.stringify({ scope, id: items[items.length - 1].id })).toString("base64url") : null };
}

async function projectAccess(actorId: string, projectId: string) {
  if (!uuid.safeParse(projectId).success) throw inaccessible();
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw inaccessible();
  return access;
}

async function taskAccess(actorId: string, projectId: string, taskId: string) {
  await projectAccess(actorId, projectId);
  if (!uuid.safeParse(taskId).success) throw inaccessible();
  const [task] = await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!task) throw inaccessible();
}

/** Stable ID pagination; action grouping applies within the loaded page, not a global ranking. */
export async function listConsoleTasks(actorId: string, projectId: string, options: PageOptions = {}) {
  const access = await projectAccess(actorId, projectId);
  const limit = pageSize(options.limit, 50);
  const scope = `tasks:${projectId}`;
  const after = cursorId(options.cursor, scope);
  const rows = await db.select({
    id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority,
    sortOrder: tasks.sortOrder, assigneeId: tasks.assigneeId, assigneeName: users.name,
    assigneeKind: users.kind, dueDate: tasks.dueDate, committedAt: tasks.committedAt,
    committedHandoffVersion: tasks.committedHandoffVersion, handoffVersion: tasks.handoffVersion,
  }).from(tasks).leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(eq(tasks.projectId, projectId), after ? gt(tasks.id, after) : undefined))
    .orderBy(asc(tasks.id)).limit(limit + 1);
  const result = page(rows, limit, scope);
  if (!result.items.length) return { ...result, items: [], canReview: access.role === "admin" || access.role === "teacher" };
  const ids = result.items.map((task) => task.id);
  // Two batch queries regardless of task count. No results, errors, logs or conversation bodies.
  const [runs, counts] = await Promise.all([
    db.selectDistinctOn([agentRuns.taskId], {
      taskId: agentRuns.taskId, id: agentRuns.id, status: agentRuns.status,
      createdAt: agentRuns.createdAt, startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt,
    }).from(agentRuns).where(inArray(agentRuns.taskId, ids)).orderBy(
      asc(agentRuns.taskId), sql`case when ${agentRuns.status} in ('queued','dispatched','running') then 0 else 1 end`,
      desc(agentRuns.createdAt), asc(agentRuns.id),
    ),
    db.select({ taskId: blockers.taskId, value: count() }).from(blockers)
      .where(and(eq(blockers.projectId, projectId), inArray(blockers.taskId, ids), eq(blockers.status, "open")))
      .groupBy(blockers.taskId),
  ]);
  const runByTask = new Map(runs.map((run) => [run.taskId, run]));
  const blockerByTask = new Map(counts.map((row) => [row.taskId, row.value]));
  const canReview = access.role === "admin" || access.role === "teacher";
  return { ...result, canReview, items: result.items.map((task) => {
    const run = runByTask.get(task.id);
    return { ...toTaskRowModel({ ...task, assigneeKind: task.assigneeKind ?? "unknown",
      openBlockerCount: blockerByTask.get(task.id) ?? 0, agentRuns: run ? [run] : [],
    }, { id: actorId, canReview }, {
      canStartAgentRun: false, canViewAgentRun: true, canViewEvidence: true,
    }), assigneeName: task.assigneeName };
  }) };
}

/** Chronological history, independent of the active-first summary used in task rows. */
export async function listConsoleRuns(actorId: string, projectId: string, taskId: string, options: PageOptions = {}) {
  await taskAccess(actorId, projectId, taskId);
  const scope = `runs:${projectId}:${taskId}`;
  const limit = pageSize(options.limit, 30);
  const after = cursorId(options.cursor, scope);
  if (after) {
    const [anchor] = await db.select({ id: agentRuns.id }).from(agentRuns)
      .where(and(eq(agentRuns.id, after), eq(agentRuns.taskId, taskId)));
    if (!anchor) throw new AppError("分页游标已失效");
  }
  const rows = await db.select({ id: agentRuns.id, taskId: agentRuns.taskId, agentId: agentRuns.agentId,
    status: agentRuns.status, createdAt: agentRuns.createdAt, startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt,
  }).from(agentRuns).where(and(eq(agentRuns.taskId, taskId), after ? sql`
    (${agentRuns.createdAt}, ${agentRuns.id}) < (select created_at, id from agent_runs where id = ${after}::uuid)
  ` : undefined)).orderBy(desc(agentRuns.createdAt), desc(agentRuns.id)).limit(limit + 1);
  return page(rows, limit, scope);
}

export async function listConsoleEvents(actorId: string, projectId: string, taskId: string, options: PageOptions = {}) {
  await taskAccess(actorId, projectId, taskId);
  const scope = `events:${projectId}:${taskId}`;
  const limit = pageSize(options.limit, 30);
  const after = cursorId(options.cursor, scope);
  if (after) {
    const [anchor] = await db.select({ id: activityEvents.id }).from(activityEvents)
      .where(and(eq(activityEvents.id, after), eq(activityEvents.taskId, taskId), eq(activityEvents.projectId, projectId)));
    if (!anchor) throw new AppError("分页游标已失效");
  }
  const rows = await db.select({ id: activityEvents.id, type: activityEvents.type,
    summary: activityEvents.summary, actorId: activityEvents.actorId, createdAt: activityEvents.createdAt,
  }).from(activityEvents).where(and(eq(activityEvents.projectId, projectId), eq(activityEvents.taskId, taskId),
    after ? sql`(${activityEvents.createdAt}, ${activityEvents.id}) <
      (select created_at, id from activity_events where id = ${after}::uuid)` : undefined,
  )).orderBy(desc(activityEvents.createdAt), desc(activityEvents.id)).limit(limit + 1);
  return page(rows, limit, scope);
}

/** Only explicitly selected run bodies are returned, after validating project AND task. */
export async function getConsoleRun(actorId: string, projectId: string, taskId: string, runId: string) {
  await taskAccess(actorId, projectId, taskId);
  if (!uuid.safeParse(runId).success) throw inaccessible();
  const [run] = await db.select().from(agentRuns).where(and(eq(agentRuns.id, runId), eq(agentRuns.taskId, taskId)));
  if (!run) throw inaccessible();
  return run;
}

export async function getConsoleConversation(actorId: string, projectId: string, taskId: string, conversationId: string) {
  await taskAccess(actorId, projectId, taskId);
  if (!uuid.safeParse(conversationId).success) throw inaccessible();
  let conversation;
  try { conversation = await getConversationForUser(actorId, conversationId); }
  catch (error) { if (error instanceof AppError) throw inaccessible(); throw error; }
  if (conversation.projectId !== projectId || conversation.taskId !== taskId) throw inaccessible();
  return { conversation, messages: await listConversationMessages(actorId, conversationId) };
}

export async function getConsoleTask(actorId: string, projectId: string, taskId: string) {
  await taskAccess(actorId, projectId, taskId);
  const task = await getTaskDetail(actorId, taskId);
  let context: Awaited<ReturnType<typeof getContextPackForUser>> | null = null;
  let contextUnavailable = false;
  if (task.contextPackId) {
    const [pack] = await db.select({ id: contextPacks.id }).from(contextPacks)
      .where(and(eq(contextPacks.id, task.contextPackId), eq(contextPacks.projectId, projectId),
        sql`(${contextPacks.taskId} is null or ${contextPacks.taskId} = ${taskId}::uuid)`));
    if (!pack) contextUnavailable = true;
    else {
      try { context = await getContextPackForUser(actorId, pack.id); }
      catch (error) { if (error instanceof AppError) contextUnavailable = true; else throw error; }
    }
  }
  const [evidence, approvals, runs, events] = await Promise.all([
    listTaskEvidence(actorId, taskId), listApprovalRequests(actorId, projectId, undefined, taskId),
    listConsoleRuns(actorId, projectId, taskId), listConsoleEvents(actorId, projectId, taskId),
  ]);
  return { task, context, contextUnavailable, evidence, runs, events,
    approvals: approvals.map(({ id, title, status, tool, canResolve, permissionReason, sourceConversationId }) =>
      ({ id, title, status, tool, canResolve, permissionReason, sourceConversationId })),
    capabilities: { canStartAgentRun: false, canResumeAgentRun: false, canStopAgentRun: false },
  };
}
