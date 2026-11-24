import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { taskMemoryContinuations } from "@/db/schema";
import { getTaskMemoryVersion } from "./task-memory";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { canTransitionContinuation, continuationWaitingLimitMs, terminalContinuationStates, type ContinuationProgress } from "../../shared/task-memory/continuation-status";

type Record = typeof taskMemoryContinuations.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const entries = taskMemoryContinuations;
const actorTask = (actorId: string, projectId: string, taskId: string) =>
  and(eq(entries.requesterId, actorId), eq(entries.projectId, projectId), eq(entries.taskId, taskId));
const nonTerminal = notInArray(entries.state, [...terminalContinuationStates]);
const inProgress = (now: number) => and(nonTerminal,
  or(ne(entries.state, "waiting"), gt(entries.createdAt, new Date(now - continuationWaitingLimitMs))));
const claimedInProgress = and(ne(entries.state, "waiting"), nonTerminal);
async function lockActorTask(tx: Transaction, actorId: string, projectId: string, taskId: string) {
  const key = `task-memory-continuation:${actorId}:${projectId}:${taskId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
function view(record: Record) {
  // Claim ownership stays between the authenticated extension and server.
  return { id: record.id, projectId: record.projectId, taskId: record.taskId, versionId: record.versionId,
    state: record.state, sequence: record.sequence, attemptId: record.attemptId, events: record.events,
    createdAt: record.createdAt, updatedAt: record.updatedAt };
}
async function requireRecord(actorId: string, projectId: string, taskId: string, id: string) {
  const [record] = await db.select().from(taskMemoryContinuations).where(and(
    eq(taskMemoryContinuations.id, id), eq(taskMemoryContinuations.projectId, projectId), eq(taskMemoryContinuations.taskId, taskId),
  ));
  if (!record) throw new NotFoundError("接续记录不存在");
  await getTaskMemoryVersion(actorId, projectId, taskId, record.versionId);
  if (record.requesterId !== actorId) throw new ForbiddenError("请使用发起接续的同一账号连接插件");
  return record;
}
export async function createMemoryContinuation(actorId: string, projectId: string, taskId: string, id: string, versionId: string) {
  await getTaskMemoryVersion(actorId, projectId, taskId, versionId);
  return db.transaction(async tx => {
    await lockActorTask(tx, actorId, projectId, taskId);
    const [existing] = await tx.select().from(entries).where(and(actorTask(actorId, projectId, taskId), eq(entries.id, id)));
    if (existing) {
      if (existing.versionId !== versionId) throw new ConflictError("此接续请求已绑定其他记忆版本");
      return view(existing);
    }
    const now = new Date(Date.now());
    const [active] = await tx.select({ id: entries.id }).from(entries).where(and(actorTask(actorId, projectId, taskId), inProgress(now.getTime()))).limit(1);
    if (active) throw new ConflictError("你在此任务已有接续请求，请刷新接续进度，不要重复启动");
    const [saved] = await tx.insert(entries).values({ id, projectId, taskId, requesterId: actorId, versionId,
      events: [{ state: "waiting", at: now.toISOString() }], createdAt: now, updatedAt: now,
    }).onConflictDoNothing().returning();
    if (!saved) throw new ConflictError("请求编号已被使用，请刷新接续进度");
    return view(saved);
  });
}
export async function getMemoryContinuation(actorId: string, projectId: string, taskId: string, id?: string) {
  if (id) return view(await requireRecord(actorId, projectId, taskId, id));
  // Validate membership even when no request exists.
  const { listTaskMemoryVersions } = await import("./task-memory");
  await listTaskMemoryVersions(actorId, projectId, taskId);
  const [latest] = await db.select().from(entries).where(actorTask(actorId, projectId, taskId))
    .orderBy(desc(sql`(${claimedInProgress})`), desc(sql`(${inProgress(Date.now())})`), desc(entries.createdAt), desc(entries.id)).limit(1);
  return latest ? view(latest) : null;
}
export async function claimMemoryContinuation(actorId: string, projectId: string, taskId: string, id: string, versionId: string, claimId: string = randomUUID()) {
  await requireRecord(actorId, projectId, taskId, id);
  return db.transaction(async tx => {
    await lockActorTask(tx, actorId, projectId, taskId);
    const [record] = await tx.select().from(entries).where(and(actorTask(actorId, projectId, taskId), eq(entries.id, id)));
    if (!record) throw new NotFoundError("接续记录不存在");
    if (record.versionId !== versionId) throw new ConflictError("请求与所选记忆版本不一致");
    if (record.state === "received" && record.sequence === 1 && record.claimId === claimId) return { ...view(record), claimId };
    const now = new Date(Date.now());
    if (record.state !== "waiting" || now.getTime() - record.createdAt.getTime() >= continuationWaitingLimitMs) throw new ConflictError("请求已被接收或已过期，请查看网页进度，不要重复启动");
    // Also guard older waiting requests created before duplicate creation was blocked.
    const [other] = await tx.select({ id: entries.id }).from(entries).where(and(actorTask(actorId, projectId, taskId), claimedInProgress)).limit(1);
    if (other) throw new ConflictError("已有插件接收了此任务的另一条请求，请先查看原工作区");
    const [claimed] = await tx.update(entries).set({ claimId, state: "received", sequence: 1, updatedAt: now,
      events: [...record.events, { state: "received", at: now.toISOString() }],
    }).where(and(eq(entries.id, id), eq(entries.state, "waiting"), eq(entries.sequence, 0))).returning();
    if (!claimed) throw new ConflictError("另一个插件窗口已接收此请求");
    return { ...view(claimed), claimId };
  });
}
export async function reportMemoryContinuation(actorId: string, projectId: string, taskId: string, id: string, claimId: string, sequence: number, progress: ContinuationProgress) {
  const record = await requireRecord(actorId, projectId, taskId, id);
  if (!record.claimId || record.claimId !== claimId) throw new ForbiddenError("此插件未持有接续请求");
  if (record.sequence === sequence && record.state === progress.state && (progress.attemptId ?? record.attemptId) === record.attemptId) return view(record);
  if (sequence !== record.sequence + 1 || !canTransitionContinuation(record.state, progress.state)) throw new ConflictError("接续回执顺序冲突，请查看最新状态");
  if (["launching", "running", "finished", "unknown"].includes(progress.state) && !progress.attemptId) throw new AppError("此回执缺少执行记录");
  if (progress.state === "running" && progress.sessionConfirmed !== true) throw new AppError("尚未收到真实会话回执");
  if (record.attemptId && progress.attemptId && record.attemptId !== progress.attemptId) throw new ConflictError("执行记录不能替换");
  const now = new Date();
  const [saved] = await db.update(taskMemoryContinuations).set({ state: progress.state, sequence, updatedAt: now,
    attemptId: progress.attemptId ?? record.attemptId, events: [...record.events, { state: progress.state, at: now.toISOString() }],
  }).where(and(eq(taskMemoryContinuations.id, id), eq(taskMemoryContinuations.claimId, claimId), eq(taskMemoryContinuations.sequence, record.sequence))).returning();
  if (!saved) throw new ConflictError("接续状态已更新，请重新读取");
  return view(saved);
}
