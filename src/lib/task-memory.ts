import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskMemoryVersions, tasks, users } from "@/db/schema";
import { memoryTransferDigest, parseMemoryHandoffExport } from "../../shared/task-memory/transfer";
import { getProjectForUser } from "./project";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";

async function requireTask(actorId: string, projectId: string, taskId: string) {
  if (!await getProjectForUser(actorId, projectId)) throw new ForbiddenError("无权访问此项目");
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!task) throw new NotFoundError("任务不存在或不属于此项目");
}

export async function saveTaskMemory(actorId: string, projectId: string, taskId: string, value: unknown, serverOrigin: string) {
  await requireTask(actorId, projectId, taskId);
  let payload;
  try { payload = parseMemoryHandoffExport(value); }
  catch (error) { throw new AppError(error instanceof Error ? error.message : "记忆格式无效"); }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 2 * 1024 * 1024) throw new AppError("记忆材料超过 2 MiB");
  if (payload.material.scope.projectId !== projectId || payload.material.scope.taskId !== taskId ||
      payload.material.scope.serverOrigin !== new URL(serverOrigin).toString()) throw new AppError("这份记忆属于其他服务、项目或任务，请在对应任务中保存");
  if (payload.memory.parentReference) {
    const reference = payload.memory.parentReference;
    const [parent] = await db.select({ payload: taskMemoryVersions.payload }).from(taskMemoryVersions).where(and(
      eq(taskMemoryVersions.projectId, projectId), eq(taskMemoryVersions.taskId, taskId),
      eq(taskMemoryVersions.memoryId, reference.memoryId), eq(taskMemoryVersions.revision, reference.revision),
    ));
    if (parent && memoryTransferDigest(parent.payload.memory) !== reference.memoryDigest) throw new ConflictError("父记忆版本的内容校验不一致，请核对接续来源");
  }
  const [saved] = await db.insert(taskMemoryVersions).values({
    projectId, taskId, creatorId: actorId, title: payload.material.goal[0]?.slice(0, 200) || "任务工作记忆",
    memoryId: payload.memory.id, revision: payload.memory.revision, materialDigest: payload.material.materialDigest, payload,
  }).onConflictDoNothing().returning();
  if (saved) return saved;
  const [existing] = await db.select().from(taskMemoryVersions).where(and(
    eq(taskMemoryVersions.projectId, projectId), eq(taskMemoryVersions.taskId, taskId),
    eq(taskMemoryVersions.memoryId, payload.memory.id), eq(taskMemoryVersions.revision, payload.memory.revision),
  ));
  if (!existing || existing.materialDigest !== payload.material.materialDigest ||
      memoryTransferDigest(existing.payload.memory) !== memoryTransferDigest(payload.memory)) throw new ConflictError("同一记忆版本已有不同内容；请生成新版本，历史未被覆盖");
  return existing;
}

export async function listTaskMemoryVersions(actorId: string, projectId: string, taskId: string) {
  await requireTask(actorId, projectId, taskId);
  const records = await db.select({
    id: taskMemoryVersions.id, title: taskMemoryVersions.title, revision: taskMemoryVersions.revision,
    creatorName: users.name, createdAt: taskMemoryVersions.createdAt,
    memoryId: taskMemoryVersions.memoryId, payload: taskMemoryVersions.payload,
  }).from(taskMemoryVersions).leftJoin(users, eq(users.id, taskMemoryVersions.creatorId))
    .where(and(eq(taskMemoryVersions.projectId, projectId), eq(taskMemoryVersions.taskId, taskId)))
    .orderBy(desc(taskMemoryVersions.createdAt), desc(taskMemoryVersions.id)).limit(50);
  return records.map((record) => ({ ...record, memoryDigest: memoryTransferDigest(record.payload.memory) }));
}

export async function getTaskMemoryVersion(actorId: string, projectId: string, taskId: string, versionId: string) {
  await requireTask(actorId, projectId, taskId);
  const [record] = await db.select().from(taskMemoryVersions).where(and(
    eq(taskMemoryVersions.id, versionId), eq(taskMemoryVersions.projectId, projectId), eq(taskMemoryVersions.taskId, taskId),
  ));
  if (!record) throw new NotFoundError("此任务中没有该记忆版本");
  return record;
}
