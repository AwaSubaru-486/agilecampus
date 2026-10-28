import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskMemoryContinuations } from "@/db/schema";
import { getTaskMemoryVersion } from "./task-memory";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { canTransitionContinuation, type ContinuationProgress } from "../../shared/task-memory/continuation-status";

type Record = typeof taskMemoryContinuations.$inferSelect;
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
  const now = new Date();
  const [saved] = await db.insert(taskMemoryContinuations).values({ id, projectId, taskId, requesterId: actorId, versionId,
    events: [{ state: "waiting", at: now.toISOString() }], createdAt: now, updatedAt: now,
  }).onConflictDoNothing().returning();
  if (saved) return view(saved);
  const existing = await requireRecord(actorId, projectId, taskId, id);
  if (existing.versionId !== versionId) throw new ConflictError("此接续请求已绑定其他记忆版本");
  return view(existing);
}
export async function getMemoryContinuation(actorId: string, projectId: string, taskId: string, id?: string) {
  if (id) return view(await requireRecord(actorId, projectId, taskId, id));
  // Validate membership even when no request exists.
  const { listTaskMemoryVersions } = await import("./task-memory");
  await listTaskMemoryVersions(actorId, projectId, taskId);
  const [latest] = await db.select().from(taskMemoryContinuations).where(and(
    eq(taskMemoryContinuations.projectId, projectId), eq(taskMemoryContinuations.taskId, taskId), eq(taskMemoryContinuations.requesterId, actorId),
  )).orderBy(desc(taskMemoryContinuations.createdAt), desc(taskMemoryContinuations.id)).limit(1);
  return latest ? view(latest) : null;
}
export async function claimMemoryContinuation(actorId: string, projectId: string, taskId: string, id: string, versionId: string, claimId: string = randomUUID()) {
  const record = await requireRecord(actorId, projectId, taskId, id);
  if (record.versionId !== versionId) throw new ConflictError("请求与所选记忆版本不一致");
  if (record.state === "received" && record.sequence === 1 && record.claimId === claimId) return { ...view(record), claimId };
  if (record.state !== "waiting" || Date.now() - record.createdAt.getTime() > 10 * 60_000) throw new ConflictError("请求已被接收或已过期，请查看网页进度，不要重复启动");
  const now = new Date();
  const [claimed] = await db.update(taskMemoryContinuations).set({ claimId, state: "received", sequence: 1, updatedAt: now,
    events: [...record.events, { state: "received", at: now.toISOString() }],
  }).where(and(eq(taskMemoryContinuations.id, id), eq(taskMemoryContinuations.state, "waiting"), eq(taskMemoryContinuations.sequence, 0))).returning();
  if (!claimed) throw new ConflictError("另一个插件窗口已接收此请求");
  return { ...view(claimed), claimId };
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
