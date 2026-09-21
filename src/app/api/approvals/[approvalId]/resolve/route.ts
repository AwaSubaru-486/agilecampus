import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveApprovalRequest } from "@/lib/approval";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  payload: z.unknown().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { approvalId } = await context.params;
  if (!z.uuid().safeParse(approvalId).success) {
    return NextResponse.json({ error: "审批参数无效" }, { status: 400 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  try {
    const approval = await resolveApprovalRequest(session.user.id, approvalId, parsed.data);
    return NextResponse.json({ approval, result: approval.result });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[/api/approvals/:id/resolve] 审批失败:", error);
    return NextResponse.json({ error: "审批失败，请重试" }, { status: 500 });
  }
}

