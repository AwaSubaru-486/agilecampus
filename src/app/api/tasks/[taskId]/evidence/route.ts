import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { createEvidenceItem, EVIDENCE_TYPES, listTaskEvidence } from "@/lib/evidence";

const inputSchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(8_000),
  sourceId: z.uuid().nullable().optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[task/evidence] 请求失败", error);
  return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
}

async function actor() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const userId = await actor();
  if (!userId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { taskId } = await context.params;
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "任务参数无效" }, { status: 400 });
  try {
    return NextResponse.json({ evidence: await listTaskEvidence(userId, taskId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const userId = await actor();
  if (!userId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { taskId } = await context.params;
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "任务参数无效" }, { status: 400 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  try {
    return NextResponse.json({ evidence: await createEvidenceItem(userId, taskId, parsed.data) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
