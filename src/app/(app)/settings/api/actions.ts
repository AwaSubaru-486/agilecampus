"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { saveModelConfig } from "@/lib/model-config";
import { AppError } from "@/lib/errors";
import { z } from "zod";

export async function saveApiConfig(_previous: { error?: string; success?: string } | null, form: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { error: "请先登录" };
  try {
    await saveModelConfig(session.user.id, { baseUrl: form.get("baseUrl"), model: form.get("model"), apiKey: form.get("apiKey") });
    revalidatePath("/settings/api");
    return { success: "配置已保存。任务生成和 AI 会话将使用此配置，实际调用时验证连接。" };
  } catch (error) {
    return { error: error instanceof z.ZodError ? error.issues[0]?.message ?? "请检查配置" : error instanceof AppError ? error.message : "配置保存失败，请重试" };
  }
}
