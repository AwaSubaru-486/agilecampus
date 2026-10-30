"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { runProjectOperation } from "@/lib/project-operation";
import { bindTaskContextPack } from "@/lib/task-material";
import { createProjectMemory } from "@/lib/project-memory";

export type MaterialState = { error: string } | { ok: true } | null;
const target = { projectId: z.uuid(), taskId: z.uuid() };

async function materialActor() {
  const session = await auth();
  if (!session?.user) throw new ForbiddenError("请先登录");
  return session.user.id;
}

export async function bindTaskMaterialAction(_previous: MaterialState, data: FormData): Promise<MaterialState> {
  const parsed = z.object({ ...target, contextPackId: z.union([z.uuid(), z.literal("")]) }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: "请选择有效的交接资料包" };
  try {
    await runProjectOperation(await materialActor(), parsed.data.projectId, "绑定交接资料", actorId => bindTaskContextPack(actorId, parsed.data.projectId, parsed.data.taskId, parsed.data.contextPackId || null), { kind: "task", id: parsed.data.taskId });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}

export async function addTaskMemoryAction(_previous: MaterialState, data: FormData): Promise<MaterialState> {
  const parsed = z.object({
    ...target,
    category: z.enum(["constraint", "decision", "learned", "rejected_approach"]),
    title: z.string().trim().min(1, "请填写记忆标题").max(200),
    content: z.string().trim().min(1, "请填写记忆内容").max(5000),
    codeRefSha: z.string().trim().max(128).optional(),
  }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const { projectId, ...input } = parsed.data;
    await runProjectOperation(await materialActor(), projectId, "添加项目记忆", actorId => createProjectMemory(actorId, projectId, input), { kind: "task", id: input.taskId });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
