import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listApprovalRequests } from "@/lib/approval";
import { AppError, ForbiddenError } from "@/lib/errors";

const statusSchema = z.enum(["pending", "executing", "executed", "rejected", "failed"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
  const status = new URL(request.url).searchParams.get("status");
  const parsedStatus = status ? statusSchema.safeParse(status) : { success: true as const, data: undefined };
  if (!parsedStatus.success) return NextResponse.json({ error: "状态参数无效" }, { status: 400 });

  try {
    const approvals = await listApprovalRequests(session.user.id, projectId, parsedStatus.data);
    return NextResponse.json({ approvals });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[/api/projects/:id/approvals] 查询失败:", error);
    return NextResponse.json({ error: "查询失败，请重试" }, { status: 500 });
  }
}

