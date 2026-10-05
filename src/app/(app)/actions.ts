"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { raiseBlocker, resolveBlocker } from "@/lib/blocker";

export type FormState = { error: string } | null;

// 全局悬浮入口的动作。放在 (app) 层而非某个项目目录下——
// 它本就是从任意页面发起的，不属于任何单个项目路由。
const raiseBlockerSchema = z.object({
  projectId: z.uuid(),
  // 可空：全局入口不强制先找到任务
  taskId: z.string().optional(),
  reason: z.enum(["tech", "resource", "unclear", "time", "dependency", "other"]),
  detail: z.string().trim().optional(),
  helpNeeded: z.string().trim().optional(),
  inviteeIds: z.array(z.uuid()).optional(),
});

export async function raiseBlockerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = raiseBlockerSchema.safeParse({
    ...raw,
    taskId: raw.taskId || undefined,
    detail: raw.detail || undefined,
    helpNeeded: raw.helpNeeded || undefined,
    inviteeIds: formData.getAll("inviteeIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await raiseBlocker(session.user.id, parsed.data.projectId, {
      taskId: parsed.data.taskId ?? null,
      reason: parsed.data.reason,
      detail: parsed.data.detail,
      helpNeeded: parsed.data.helpNeeded,
      inviteeIds: parsed.data.inviteeIds,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "你没有权限在该项目中求助" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const resolveBlockerSchema = z.object({
  blockerId: z.uuid(),
  projectId: z.uuid(),
  note: z.string().trim().optional(),
});

export async function resolveBlockerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = resolveBlockerSchema.safeParse({ ...raw, note: raw.note || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await resolveBlocker(session.user.id, parsed.data.blockerId, { note: parsed.data.note });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限标记该求助" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}
