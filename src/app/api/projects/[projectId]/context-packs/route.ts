import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { createContextPack, listContextPacks } from "@/lib/context-pack";

const sourceSchema = z.object({
  sourceType: z.enum([
    "project",
    "milestone",
    "task",
    "blocker",
    "entry",
    "decision",
    "conversation",
    "message",
    "activity_window",
    "manual",
  ]),
  sourceId: z.uuid().nullable().optional(),
  label: z.string().trim().max(160).optional(),
  included: z.boolean().optional(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
});

const schema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(1000).nullable().optional(),
  conversationId: z.uuid().nullable().optional(),
  taskId: z.uuid().nullable().optional(),
  sources: z.array(sourceSchema).min(1).max(100),
  status: z.enum(["draft", "frozen"]).optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[context-packs] 请求失败", error);
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
    return NextResponse.json({ contextPacks: await listContextPacks(session.user.id, projectId) });
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
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  try {
    const result = await createContextPack(session.user.id, projectId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
