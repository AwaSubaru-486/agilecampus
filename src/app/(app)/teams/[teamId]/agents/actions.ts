"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { createAgent, deleteAgent, reissueAgentToken } from "@/lib/agent-member";

export type FormState = { error: string } | null;
// 注册成功要把明文令牌带回来——它只在这一次返回，界面必须当场显示
export type RegisterState = { error: string } | { ok: true; token: string; name: string } | null;

// 能力标签：逗号分隔的自由文本。不做预置枚举——
// 「会写接口」和「会做数据清洗」哪个该是枚举值，交给团队自己定。
const registerSchema = z.object({
  teamId: z.uuid(),
  name: z.string().trim().min(1, "请给它起个名字"),
  provider: z.string().trim().min(1, "请指明它跑在什么上"),
  capabilities: z.string().optional(),
  maxConcurrent: z.coerce.number().int().min(1).max(10).optional(),
});

export async function registerAgentAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = registerSchema.safeParse({
    ...raw,
    capabilities: raw.capabilities || undefined,
    maxConcurrent: raw.maxConcurrent || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const capabilities = (parsed.data.capabilities ?? "")
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const agent = await createAgent(session.user.id, parsed.data.teamId, {
      name: parsed.data.name,
      provider: parsed.data.provider,
      capabilities,
      maxConcurrent: parsed.data.maxConcurrent,
    });
    revalidatePath(`/teams/${parsed.data.teamId}/agents`);
    return { ok: true, token: agent.token, name: agent.name };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有团队管理员可以注册 AI 成员" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

const reissueSchema = z.object({ teamId: z.uuid(), agentUserId: z.uuid() });

export async function reissueTokenAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = reissueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    const { token } = await reissueAgentToken(session.user.id, parsed.data.agentUserId);
    return { ok: true, token, name: "新令牌" };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

const deleteSchema = z.object({ teamId: z.uuid(), agentUserId: z.uuid() });

export async function deleteAgentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteAgent(session.user.id, parsed.data.agentUserId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有团队管理员可以移除 AI 成员" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/agents`);
  return null;
}
