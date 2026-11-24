import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { resolveDecision, supersedeDecision } from "@/lib/decision";
import { readJsonOrError } from "@/lib/http";

const schema = z.union([
  z.object({
    status: z.enum(["accepted", "rejected"]),
    selectedOptionId: z.uuid().nullable().optional(),
    rationale: z.string().trim().min(1).max(2_000),
  }),
  z.object({ supersedeById: z.uuid() }),
]);

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[decision] 请求失败", error);
  return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ decisionId: string }> },
) {
  const session = await auth();
  const actorId = session?.user?.id;
  if (!actorId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { decisionId } = await context.params;
  if (!z.uuid().safeParse(decisionId).success) return NextResponse.json({ error: "决策参数无效" }, { status: 400 });
  const bodyResult = await readJsonOrError(request, 256 * 1024);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = schema.safeParse(bodyResult.body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });

  try {
    if ("supersedeById" in parsed.data) {
      return NextResponse.json({ decision: await supersedeDecision(actorId, decisionId, parsed.data.supersedeById) });
    }
    return NextResponse.json({ decision: await resolveDecision(actorId, decisionId, parsed.data) });
  } catch (error) {
    return errorResponse(error);
  }
}
