import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getApprovalRequestForUser } from "@/lib/approval";
import { AppError, ForbiddenError } from "@/lib/errors";

export async function GET(
  _request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { approvalId } = await context.params;
  if (!z.uuid().safeParse(approvalId).success) {
    return NextResponse.json({ error: "审批参数无效" }, { status: 400 });
  }

  try {
    const approval = await getApprovalRequestForUser(session.user.id, approvalId);
    return NextResponse.json({ approval });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("[/api/approvals/:id] 查询失败:", error);
    return NextResponse.json({ error: "查询失败，请重试" }, { status: 500 });
  }
}

