import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createConversation,
  listProjectConversations,
} from "@/lib/agent/conversation";
import { AppError, ForbiddenError } from "@/lib/errors";

const createSchema = z.object({
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
  console.error("[conversations] 请求失败", error);
  return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
  }

  try {
    const items = await listProjectConversations(session.user.id, projectId);
    return NextResponse.json({ conversations: items });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  try {
    const conversation = await createConversation(session.user.id, projectId, parsed.data);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
