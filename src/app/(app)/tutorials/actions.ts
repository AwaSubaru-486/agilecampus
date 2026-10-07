"use server";

import { auth } from "@/lib/auth";
import {
  updateTutorialProgress,
  updateTutorialExample,
  type TutorialCommand,
} from "@/lib/tutorials/progress";

export async function saveTutorialProgress(command: TutorialCommand) {
  const session = await auth();
  if (!session?.user) return { error: "请重新登录后保存教程进度" };
  try {
    return { progress: await updateTutorialProgress(session.user.id, command) };
  } catch {
    return { error: "教程进度未保存，请重试。当前操作仍保留在页面中。" };
  }
}

export async function completeExampleStep(
  phase: number,
  values: Record<string, string>,
) {
  const session = await auth();
  if (!session?.user) return { error: "请重新登录后练习" };
  try {
    return {
      sample: await updateTutorialExample(session.user.id, phase, values),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "练习保存失败，请重试",
    };
  }
}
