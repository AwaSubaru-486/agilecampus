import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { projectIterations, projects, teamMembers } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, isUniqueViolation } from "./errors";
import { getProjectForUser } from "./project";
import { recordEvent } from "./activity";
import { FEATURE_CHANGES, type IterationView } from "./iteration-types";

const featureSchema = z.object({
  id: z.uuid().default(() => randomUUID()),
  name: z.string().trim().min(1, "请填写功能模块名称").max(60, "模块名称最多 60 字"),
  summary: z.string().trim().min(1, "请说明这个模块带来的功能变化").max(500, "模块说明最多 500 字"),
  change: z.enum(FEATURE_CHANGES).default("added"),
});
export const iterationExecutionSchema = z.object({
  executionNotes: z.string().trim().max(10000).default(""),
  validationNotes: z.string().trim().max(5000).default(""),
  releaseNotes: z.string().trim().max(10000).default(""),
  releaseUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "成果链接须为 http 或 https 地址" }).max(2000)]).default(""),
});
export const iterationInputSchema = z.object({
  version: z.string().trim().min(1, "请填写版本号").max(40, "版本号最多 40 字").transform(v => v.toLowerCase()),
  title: z.string().trim().min(1, "请填写迭代名称").max(120, "迭代名称最多 120 字"),
  goal: z.string().trim().max(5000).default(""),
  startDate: z.iso.date("开始日期不正确").nullable().default(null),
  endDate: z.iso.date("结束日期不正确").nullable().default(null),
  baseIterationId: z.uuid().nullable().default(null),
  features: z.array(featureSchema).max(30, "一个版本最多记录 30 个功能模块").default([]),
}).refine(v => !v.startDate || !v.endDate || v.startDate <= v.endDate, { message: "结束日期不能早于开始日期", path: ["endDate"] })
  .refine(v => new Set(v.features.map(f => f.name.toLocaleLowerCase())).size === v.features.length, { message: "同一版本的模块名称不能重复", path: ["features"] })
  .refine(v => new Set(v.features.map(f => f.id)).size === v.features.length, { message: "模块标识不能重复", path: ["features"] });
export type IterationInput = z.input<typeof iterationInputSchema>;
export type IterationExecutionInput = z.input<typeof iterationExecutionSchema>;

async function requireManager(tx: DbTx, actorId: string, projectId: string) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!project) throw new ForbiddenError();
  const [member] = await tx.select().from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, actorId)));
  if (member?.role !== "admin") throw new ForbiddenError("只有组长可以管理迭代");
}
async function editableIteration(tx: DbTx, projectId: string, id: string, updatedAt: string) {
  const [current] = await tx.select().from(projectIterations).where(and(eq(projectIterations.id, id), eq(projectIterations.projectId, projectId)));
  if (!current) throw new ForbiddenError();
  if (current.status === "released") throw new AppError("已发布版本已归档，请基于它发起下一轮迭代");
  if (current.updatedAt.toISOString() !== updatedAt) throw new ConflictError("迭代已被更新，请刷新后重试");
  return current;
}
export async function listProjectIterations(actorId: string, projectId: string): Promise<IterationView[]> {
  if (!await getProjectForUser(actorId, projectId)) throw new ForbiddenError();
  const rows = await db.select().from(projectIterations).where(eq(projectIterations.projectId, projectId)).orderBy(desc(projectIterations.createdAt), desc(projectIterations.id));
  return rows.map(row => ({
    id: row.id, version: row.version, title: row.title, goal: row.goal, releaseNotes: row.releaseNotes,
    status: row.status, startDate: row.startDate, endDate: row.endDate, baseIterationId: row.baseIterationId,
    features: row.features, executionNotes: row.executionNotes, validationNotes: row.validationNotes, releaseUrl: row.releaseUrl,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), releasedAt: row.releasedAt?.toISOString() ?? null,
  }));
}
export async function saveProjectIteration(actorId: string, projectId: string, input: IterationInput, edit?: { id: string; updatedAt: string }) {
  const parsed = iterationInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const values = parsed.data;
  try {
    return await db.transaction(async tx => {
      await requireManager(tx, actorId, projectId);
      const current = edit ? await editableIteration(tx, projectId, edit.id, edit.updatedAt) : null;
      if (current?.status === "active" && (!values.goal || !values.features.length)) throw new AppError("进行中的迭代需要保留目标和功能模块");
      if (values.baseIterationId) {
        const [base] = await tx.select({ id: projectIterations.id }).from(projectIterations).where(and(eq(projectIterations.id, values.baseIterationId), eq(projectIterations.projectId, projectId), eq(projectIterations.status, "released")));
        if (!base) throw new AppError("基准必须是当前项目已发布的版本");
      }
      const [saved] = edit
        ? await tx.update(projectIterations).set({ ...values, updatedAt: new Date() }).where(eq(projectIterations.id, edit.id)).returning()
        : await tx.insert(projectIterations).values({ ...values, projectId, createdById: actorId }).returning();
      await recordEvent(tx, { projectId, actorId, type: "project_updated", summary: `${edit ? "更新" : "规划"}迭代「${saved.version} · ${saved.title}」`, payload: { iterationId: saved.id, version: saved.version, action: edit ? "iteration_updated" : "iteration_created" } });
      return saved;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("此项目已存在相同版本号，请使用新的版本号");
    throw error;
  }
}
export async function saveIterationExecution(actorId: string, projectId: string, iterationId: string, expectedUpdatedAt: string, input: IterationExecutionInput) {
  const parsed = iterationExecutionSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  return db.transaction(async tx => {
    await requireManager(tx, actorId, projectId);
    const current = await editableIteration(tx, projectId, iterationId, expectedUpdatedAt);
    if (current.status !== "active") throw new AppError("请先开始迭代，再记录推进与验证");
    const [saved] = await tx.update(projectIterations).set({ ...parsed.data, updatedAt: new Date() }).where(eq(projectIterations.id, iterationId)).returning();
    await recordEvent(tx, { projectId, actorId, type: "project_updated", summary: `记录迭代「${saved.version}」的推进与验证`, payload: { iterationId, action: "iteration_execution_updated" } });
    return saved;
  });
}
export async function changeIterationStatus(actorId: string, projectId: string, iterationId: string, action: "start" | "release", expectedUpdatedAt: string) {
  return db.transaction(async tx => {
    await requireManager(tx, actorId, projectId);
    const current = await editableIteration(tx, projectId, iterationId, expectedUpdatedAt);
    if (action === "start" && current.status !== "planned") throw new AppError("只有计划中的迭代可以开始");
    if (action === "release" && current.status !== "active") throw new AppError("请先开始迭代，再发布");
    if (!current.goal.trim() || !current.features.length) throw new AppError("请先明确本版目标和功能模块");
    if (action === "release" && (!current.validationNotes.trim() || !current.releaseNotes.trim())) throw new AppError("发布前请保存验证结果和版本说明");
    const now = new Date();
    const [saved] = await tx.update(projectIterations).set({ status: action === "start" ? "active" : "released", updatedAt: now,
      ...(action === "release" ? { releasedAt: now } : {}),
    }).where(eq(projectIterations.id, iterationId)).returning();
    await recordEvent(tx, { projectId, actorId, type: "project_updated", summary: `${action === "start" ? "开始" : "发布"}迭代「${saved.version} · ${saved.title}」`, payload: { iterationId, version: saved.version, action: action === "start" ? "iteration_started" : "iteration_released" } });
    return saved;
  });
}
