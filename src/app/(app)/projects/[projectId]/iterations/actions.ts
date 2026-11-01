"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { runProjectOperation } from "@/lib/project-operation";
import { changeIterationStatus, saveProjectIteration } from "@/lib/project-iterations";

type Result = { ok: true } | { error: string };
const target = z.object({ projectId: z.uuid(), iterationId: z.uuid(), updatedAt: z.iso.datetime() });

export async function saveIterationAction(data: FormData): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const projectId = data.get("projectId");
  if (!z.uuid().safeParse(projectId).success) return { error: "项目参数不正确" };
  const edit = data.get("iterationId") ? target.safeParse({ projectId, iterationId: data.get("iterationId"), updatedAt: data.get("updatedAt") }) : null;
  if (edit && !edit.success) return { error: "迭代参数不正确，请刷新后重试" };
  try {
    await runProjectOperation(session.user.id, projectId as string, "保存迭代", actorId => saveProjectIteration(actorId, projectId as string, {
      version: String(data.get("version") ?? ""), title: String(data.get("title") ?? ""),
      goal: String(data.get("goal") ?? ""), releaseNotes: String(data.get("releaseNotes") ?? ""),
      startDate: String(data.get("startDate") ?? "") || null, endDate: String(data.get("endDate") ?? "") || null,
      taskIds: data.getAll("taskIds").map(String),
    }, edit?.success ? { id: edit.data.iterationId, updatedAt: edit.data.updatedAt } : undefined));
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
