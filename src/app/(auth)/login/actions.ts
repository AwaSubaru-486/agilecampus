"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/lib/auth";
import { clientIpFromHeaders, retryAfterMessage } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export type FormState = { error: string } | null;

const LOGIN_IP_LIMIT = 20;
const LOGIN_IP_WINDOW_MS = 10 * 60 * 1000;

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ip = clientIpFromHeaders(await headers());
  const limited = rateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS);
  if (!limited.ok) return { error: retryAfterMessage(limited) };

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: formData.get("returnTo") === "home" ? "/home" : "/teams",
    });
    return null;
  } catch (e) {
    if (e instanceof AuthError) return { error: "邮箱或密码不正确" };
    throw e; // signIn 成功时抛出的 redirect 必须继续上抛
  }
}
