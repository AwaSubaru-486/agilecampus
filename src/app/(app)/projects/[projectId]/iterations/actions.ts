"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { runProjectOperation } from "@/lib/project-operation";
import { changeIterationStatus, saveProjectIteration, saveIterationExecution, continueIteration, saveIterationWorkspace, workspaceInputSchema } from "@/lib/project-iterations";

type Result = { ok: true } | { error: string };
const target = z.object({ projectId: z.uuid(), iterationId: z.uuid(), updatedAt: z.iso.datetime() });

export async function continueIterationAction(input: { projectId: string; baseId: string | null; existingId?: string }): Promise<{ id: string } | { error: string }> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const parsed = z.object({ projectId: z.uuid(), baseId: z.uuid().nullable(), existingId: z.uuid().optional() }).safeParse(input);
  if (!parsed.success) return { error: "版本参数不正确" };
  try {
    const row = await runProjectOperation(session.user.id, input.projectId, "继续开发版本", actorId => continueIteration(actorId, input.projectId, input.baseId, input.existingId));
    revalidatePath(`/projects/${input.projectId}`, "layout");
    return { id: row.id };
  } catch (error) { if (error instanceof AppError) return { error: error.message }; throw error; }
}

export async function saveWorkspaceAction(input: z.input<typeof workspaceInputSchema> & { projectId: string; iterationId: string; updatedAt: string }): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const parsed = target.safeParse(input);
  if (!parsed.success) return { error: "版本参数不正确" };
  try {
    await runProjectOperation(session.user.id, parsed.data.projectId, "保存开发版本", actorId => saveIterationWorkspace(actorId, parsed.data.projectId, parsed.data.iterationId, parsed.data.updatedAt, input));
    revalidatePath(`/projects/${input.projectId}`, "layout");
    return { ok: true };
  } catch (error) { if (error instanceof AppError) return { error: error.message }; throw error; }
}

export async function saveIterationAction(data: FormData): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const projectId = data.get("projectId");
  if (!z.uuid().safeParse(projectId).success) return { error: "项目参数不正确" };
  const edit = data.get("iterationId") ? target.safeParse({ projectId, iterationId: data.get("iterationId"), updatedAt: data.get("updatedAt") }) : null;
  if (edit && !edit.success) return { error: "迭代参数不正确，请刷新后重试" };
  let features;
  try { features = JSON.parse(String(data.get("features") ?? "[]")); } catch { return { error: "功能模块格式不正确" }; }
  try {
    await runProjectOperation(session.user.id, projectId as string, "保存迭代", actorId => saveProjectIteration(actorId, projectId as string, {
      version: String(data.get("version") ?? ""), title: String(data.get("title") ?? ""),
      goal: String(data.get("goal") ?? ""), features,
      startDate: String(data.get("startDate") ?? "") || null, endDate: String(data.get("endDate") ?? "") || null,
      baseIterationId: String(data.get("baseIterationId") ?? "") || null,
    }, edit?.success ? { id: edit.data.iterationId, updatedAt: edit.data.updatedAt } : undefined));
  } catch (error) { if (error instanceof AppError) return { error: error.message }; throw error; }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function saveIterationExecutionAction(data: FormData): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const parsed = target.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: "迭代参数不正确，请刷新后重试" };
  const { projectId, iterationId, updatedAt } = parsed.data;
  try {
    await runProjectOperation(session.user.id, projectId, "记录迭代推进", actorId => saveIterationExecution(actorId, projectId, iterationId, updatedAt, {
      executionNotes: String(data.get("executionNotes") ?? ""), validationNotes: String(data.get("validationNotes") ?? ""),
      releaseNotes: String(data.get("releaseNotes") ?? ""), releaseUrl: String(data.get("releaseUrl") ?? "").trim(),
    }));
  } catch (error) { if (error instanceof AppError) return { error: error.message }; throw error; }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function changeIterationStatusAction(input: { projectId: string; iterationId: string; updatedAt: string; action: "start" | "release" }): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const parsed = target.extend({ action: z.enum(["start", "release"]) }).safeParse(input);
  if (!parsed.success) return { error: "迭代参数不正确，请刷新后重试" };
  const { projectId, iterationId, action, updatedAt } = parsed.data;
  try {
    await runProjectOperation(session.user.id, projectId, "更新迭代状态", actorId => changeIterationStatus(actorId, projectId, iterationId, action, updatedAt));
  } catch (error) { if (error instanceof AppError) return { error: error.message }; throw error; }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}
