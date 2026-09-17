import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  getConversationForUser,
  listConversationMessages,
  updateConversation,
} from "@/lib/agent/conversation";
import { AppError, ForbiddenError } from "@/lib/errors";

const updateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  visibility: z.enum(["private", "project"]).optional(),
  taskId: z.uuid().nullable().optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: "没有权限" }, { status: 403 });
  }
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error("[conversation] 请求失败", error);
  return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { conversationId } = await context.params;
  if (!z.uuid().safeParse(conversationId).success) {
    return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
  }

  try {
    const [conversation, messages] = await Promise.all([
      getConversationForUser(session.user.id, conversationId),
      listConversationMessages(session.user.id, conversationId),
    ]);
    return NextResponse.json({ conversation, messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { conversationId } = await context.params;
  if (!z.uuid().safeParse(conversationId).success) {
    return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  try {
    const conversation = await updateConversation(session.user.id, conversationId, parsed.data);
    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}
