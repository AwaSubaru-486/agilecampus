import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { forkConversation } from "@/lib/agent/conversation";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  throughMessageId: z.uuid(),
  title: z.string().trim().max(120).optional(),
  visibility: z.enum(["private", "project"]).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { conversationId } = await context.params;
  if (!z.uuid().safeParse(conversationId).success) {
    return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  try {
    const conversation = await forkConversation(
      session.user.id,
      conversationId,
      parsed.data.throughMessageId,
      parsed.data,
    );
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: "没有权限" }, { status: 403 });
    }
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[conversation/fork] 创建分支失败", error);
    return NextResponse.json({ error: "创建分支失败，请重试" }, { status: 500 });
  }
}
