import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { iterationTasks, projectIterations, projects, tasks, teamMembers, users } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, isUniqueViolation } from "./errors";
import { getProjectForUser } from "./project";
import { recordEvent } from "./activity";
import type { IterationTask, IterationView } from "./iteration-types";

export const iterationInputSchema = z.object({
  version: z.string().trim().min(1, "请填写版本号").max(40, "版本号最多 40 字").transform(v => v.toLowerCase()),
  title: z.string().trim().min(1, "请填写迭代名称").max(120, "迭代名称最多 120 字"),
  goal: z.string().trim().max(5000).default(""),
  releaseNotes: z.string().trim().max(10000).default(""),
  startDate: z.iso.date("开始日期不正确").nullable().default(null),
  endDate: z.iso.date("结束日期不正确").nullable().default(null),
  taskIds: z.array(z.uuid()).max(500, "每个迭代最多关联 500 项任务").default([]),
}).refine(v => !v.startDate || !v.endDate || v.startDate <= v.endDate, { message: "结束日期不能早于开始日期", path: ["endDate"] });
export type IterationInput = z.input<typeof iterationInputSchema>;

async function requireManager(tx: DbTx, actorId: string, projectId: string) {
  // Serialize changes within a project; repeat the role check inside the transaction.
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!project) throw new ForbiddenError();
  const [member] = await tx.select().from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, actorId)));
  if (member?.role !== "admin") throw new ForbiddenError("只有组长可以管理迭代");
}

async function taskRows(exec: DbTx | typeof db, projectId: string, ids?: string[], lock = false): Promise<IterationTask[]> {
  if (ids?.length === 0) return [];
  const query = exec.select({ id: tasks.id, title: tasks.title, status: tasks.status, assigneeName: users.name })
    .from(tasks).leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.isTaskGroup, false), ids ? inArray(tasks.id, ids) : undefined))
    .orderBy(tasks.createdAt, tasks.id);
  return lock ? query.for("update", { of: tasks }) : query;
}

export async function listProjectIterationTasks(actorId: string, projectId: string) {
  if (!await getProjectForUser(actorId, projectId)) throw new ForbiddenError();
  return taskRows(db, projectId);
}

export async function listProjectIterations(actorId: string, projectId: string): Promise<IterationView[]> {
  if (!await getProjectForUser(actorId, projectId)) throw new ForbiddenError();
  const rows = await db.select().from(projectIterations).where(eq(projectIterations.projectId, projectId)).orderBy(desc(projectIterations.createdAt), desc(projectIterations.id));
  if (!rows.length) return [];
  const links = await db.select({ iterationId: iterationTasks.iterationId, id: tasks.id, title: tasks.title, status: tasks.status, assigneeName: users.name })
    .from(iterationTasks).innerJoin(tasks, eq(iterationTasks.taskId, tasks.id)).leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(inArray(iterationTasks.iterationId, rows.map(row => row.id)), eq(tasks.projectId, projectId), eq(tasks.isTaskGroup, false)))
    .orderBy(tasks.createdAt, tasks.id);
  return rows.map(row => ({
    id: row.id, version: row.version, title: row.title, goal: row.goal, releaseNotes: row.releaseNotes,
    status: row.status, startDate: row.startDate, endDate: row.endDate,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), releasedAt: row.releasedAt?.toISOString() ?? null,
    tasks: row.status === "released" ? row.taskSnapshot ?? [] : links.filter(link => link.iterationId === row.id).map(task => ({ id: task.id, title: task.title, status: task.status, assigneeName: task.assigneeName })),
  }));
}

export async function saveProjectIteration(actorId: string, projectId: string, input: IterationInput, edit?: { id: string; updatedAt: string }) {
  const parsed = iterationInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const { taskIds, ...values } = parsed.data;
  const ids = [...new Set(taskIds)];
  try {
    return await db.transaction(async tx => {
      await requireManager(tx, actorId, projectId);
      if (edit) {
        const [current] = await tx.select().from(projectIterations).where(and(eq(projectIterations.id, edit.id), eq(projectIterations.projectId, projectId)));
        if (!current) throw new ForbiddenError();
        if (current.status === "released") throw new AppError("已发布的版本保留为历史记录，请新建下一轮迭代");
        if (current.updatedAt.toISOString() !== edit.updatedAt) throw new ConflictError("迭代已被更新，请刷新后重新编辑");
      }
      const selected = await taskRows(tx, projectId, ids, true);
      if (selected.length !== ids.length) throw new AppError("只能关联当前项目的普通任务，请刷新任务列表");
      const [saved] = edit
        ? await tx.update(projectIterations).set({ ...values, updatedAt: new Date() }).where(and(eq(projectIterations.id, edit.id), eq(projectIterations.projectId, projectId))).returning()
        : await tx.insert(projectIterations).values({ ...values, projectId, createdById: actorId }).returning();
      await tx.delete(iterationTasks).where(eq(iterationTasks.iterationId, saved.id));
      if (ids.length) await tx.insert(iterationTasks).values(ids.map(taskId => ({ iterationId: saved.id, taskId })));
      await recordEvent(tx, { projectId, actorId, type: "project_updated", summary: `${edit ? "更新" : "创建"}迭代「${saved.version} · ${saved.title}」`, payload: { iterationId: saved.id, version: saved.version, action: edit ? "iteration_updated" : "iteration_created", taskIds: ids } });
      return saved;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("此项目已存在相同版本号，请使用新的版本号");
    throw error;
  }
}

export async function changeIterationStatus(actorId: string, projectId: string, iterationId: string, action: "start" | "release", expectedUpdatedAt: string) {
  return db.transaction(async tx => {
    await requireManager(tx, actorId, projectId);
    const [current] = await tx.select().from(projectIterations).where(and(eq(projectIterations.id, iterationId), eq(projectIterations.projectId, projectId)));
    if (!current) throw new ForbiddenError();
    if (current.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictError("迭代已被更新，请刷新后重试");
    if (action === "start" && current.status !== "planned") throw new AppError("只有计划中的迭代可以开始");
    if (action === "release" && current.status !== "active") throw new AppError("请先开始迭代，再标记为已发布");
    const links = await tx.select().from(iterationTasks).where(eq(iterationTasks.iterationId, iterationId));
    const snapshot = await taskRows(tx, projectId, links.map(link => link.taskId), true);
    if (action === "release" && snapshot.some(task => task.status !== "done")) throw new AppError("关联任务全部验收完成后，才能标记为已发布");
    const now = new Date();
    const [saved] = await tx.update(projectIterations).set({ status: action === "start" ? "active" : "released", updatedAt: now,
      ...(action === "release" ? { releasedAt: now, taskSnapshot: snapshot } : {}),
    }).where(eq(projectIterations.id, iterationId)).returning();
    await recordEvent(tx, { projectId, actorId, type: "project_updated", summary: `${action === "start" ? "开始" : "发布"}迭代「${saved.version} · ${saved.title}」`, payload: { iterationId, version: saved.version, action: action === "start" ? "iteration_started" : "iteration_released" } });
    return saved;
  });
}
