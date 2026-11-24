"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createUser } from "@/lib/user";
import { AppError } from "@/lib/errors";
import { clientIpFromHeaders, retryAfterMessage } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

const REGISTER_IP_LIMIT = 5;
const REGISTER_IP_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_GLOBAL_LIMIT = 30;

const registerSchema = z.object({
  name: z.string().min(1, "请填写姓名"),
  email: z.email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位").max(64, "密码最长 64 位"),
});

export type FormState = { error: string } | null;

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ip = clientIpFromHeaders(await headers());
  const limited = rateLimit(`register:ip:${ip}`, REGISTER_IP_LIMIT, REGISTER_IP_WINDOW_MS);
  if (!limited.ok) return { error: retryAfterMessage(limited) };
  // x-forwarded-for 在未受控的部署里可能被伪造，再加一道全站上限，避免批量注册。
  const global = rateLimit("register:global", REGISTER_GLOBAL_LIMIT, REGISTER_IP_WINDOW_MS);
  if (!global.ok) return { error: retryAfterMessage(global) };

  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createUser(parsed.data);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect("/login?registered=1");
}
