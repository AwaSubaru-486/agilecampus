import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { buildContextPackPreview } from "@/lib/context-pack";

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

const schema = z.object({ sources: z.array(sourceSchema).min(1).max(100) });

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[context-pack/preview] 请求失败", error);
  return NextResponse.json({ error: "预览失败，请重试" }, { status: 500 });
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
    const preview = await buildContextPackPreview(session.user.id, projectId, parsed.data.sources);
    return NextResponse.json(preview);
  } catch (error) {
    return errorResponse(error);
  }
}
