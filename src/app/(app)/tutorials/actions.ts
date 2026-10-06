"use server";

import { auth } from "@/lib/auth";
import { updateTutorialProgress, type TutorialCommand } from "@/lib/tutorials/progress";

export async function saveTutorialProgress(command: TutorialCommand) {
  const session = await auth();
  if (!session?.user) return { error: "请重新登录后保存教程进度" };
  try {
    return { progress: await updateTutorialProgress(session.user.id, command) };
  } catch {
    return { error: "教程进度未保存，请重试。当前操作仍保留在页面中。" };
  }
}
