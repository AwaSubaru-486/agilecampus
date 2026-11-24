import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectHealth } from "@/lib/health";
import { narrateHealth } from "@/lib/agent/health-narrator";
import { mapAgentError } from "@/lib/agent-auth";
import { retryAfterMessage } from "@/lib/http";
import { rateLimit, releaseSlot, tryAcquireSlot } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ projectId: string }> };

// 按需生成健康度综述。
//
// 刻意做成「点一下才生成」而非随页面渲染一并生成：
// 无密钥或断网时，面板仍须完整可用。确定性内容永不依赖网络。
export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { projectId: raw } = await ctx.params;
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const slotKey = `health-narrative:${session.user.id}`;
  const limited = rateLimit(slotKey, 10, 5 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json({ error: retryAfterMessage(limited) }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  if (!tryAcquireSlot(slotKey, 1)) {
    return NextResponse.json({ error: "健康度综述正在生成，请稍后刷新" }, { status: 429 });
  }

  try {
    const { issues } = await getProjectHealth(session.user.id, parsed.data);
    const text = await narrateHealth(issues, "本项目", { actorId: session.user.id });
    return NextResponse.json({ narrative: text });
  } catch (e) {
    return mapAgentError(e, "[/api/projects/health-narrative]");
  } finally {
    releaseSlot(slotKey);
  }
}
