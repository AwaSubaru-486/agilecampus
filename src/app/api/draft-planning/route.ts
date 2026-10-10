import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adviseDraftPlanning, planningRequestSchema } from "@/lib/draft-planning-ai";
import { AppError, ForbiddenError } from "@/lib/errors";
import { z } from "zod";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  // Advisory requests still consume the user's model quota; require their own site as the origin.
  try {
    if (new URL(request.headers.get("origin") ?? "").host !== request.headers.get("host")) return NextResponse.json({ error: "请求来源不正确" }, { status: 403 });
  } catch { return NextResponse.json({ error: "请求来源不正确" }, { status: 403 }); }
  const parsed = planningRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "规划参数不完整，请检查任务名称和草案" }, { status: 400 });
  try { return NextResponse.json(await adviseDraftPlanning(session.user.id, parsed.data, undefined, request.signal)); }
  catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: "只有组长可以分析草案" }, { status: 403 });
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "AI 建议缺少有效的任务关系或验收标准，请重试" }, { status: 422 });
    console.error("[draft-planning] advisory failed", error);
    return NextResponse.json({ error: "AI 分析没有完成，请检查 API 配置或稍后重试。草案未改变。" }, { status: 502 });
  }
}
