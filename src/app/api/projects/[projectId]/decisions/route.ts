import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { createDecision, listProjectDecisions } from "@/lib/decision";

const optionSchema = z.object({
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).optional(),
  benefits: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  risks: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(240),
  question: z.string().trim().min(1).max(2_000),
  taskId: z.uuid().nullable().optional(),
  milestoneId: z.uuid().nullable().optional(),
  options: z.array(optionSchema).min(1).max(8),
  sourceConversationId: z.uuid().nullable().optional(),
  sourceMessageId: z.uuid().nullable().optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[project/decisions] 请求失败", error);
  return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
}

async function actor() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const userId = await actor();
  if (!userId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
  try {
    return NextResponse.json({ decisions: await listProjectDecisions(userId, projectId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const userId = await actor();
  if (!userId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  try {
    const decision = await createDecision(userId, projectId, parsed.data);
    return NextResponse.json({ decision }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
