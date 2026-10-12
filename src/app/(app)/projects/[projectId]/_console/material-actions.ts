"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";
import { getProjectPerspective } from "@/lib/project-view";
import { bindTaskContextPack } from "@/lib/task-material";
import { createProjectMemory } from "@/lib/project-memory";

export type MaterialState = { error: string } | { ok: true } | null;
const target = { projectId: z.uuid(), taskId: z.uuid() };

async function materialActor(projectId: string) {
  const session = await auth();
  if (!session?.user) throw new ForbiddenError("请先登录");
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");
  const perspective = await getProjectPerspective(access.role, projectId, session.user.id, access.project.teamId);
  if (perspective.preview) throw new ForbiddenError("预览视角只读，请切回本人视角操作");
  return session.user.id;
}

export async function bindTaskMaterialAction(_previous: MaterialState, data: FormData): Promise<MaterialState> {
  const parsed = z.object({ ...target, contextPackId: z.union([z.uuid(), z.literal("")]) }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: "请选择有效的交接资料包" };
  try {
    const actorId = await materialActor(parsed.data.projectId);
    await bindTaskContextPack(actorId, parsed.data.projectId, parsed.data.taskId, parsed.data.contextPackId || null);
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
    const actorId = await materialActor(parsed.data.projectId);
    const { projectId, ...input } = parsed.data;
    await createProjectMemory(actorId, projectId, input);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
