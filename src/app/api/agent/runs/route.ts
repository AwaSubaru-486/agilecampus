import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { reportAgentRun } from "@/lib/agent-run";

const schema = z.object({
  taskId: z.uuid(),
  status: z.enum(["dispatched", "running", "completed", "failed", "blocked"]),
  note: z.string().trim().optional(),
  reason: z.enum(["tech", "resource", "unclear", "time", "dependency", "other"]).optional(),
  helpNeeded: z.string().trim().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});

// agent 报到。一条口子覆盖它的整个生命周期：
//
//   dispatched —— 看见了，接单
//   running    —— 在做了
//   blocked    —— 卡住了（会落成一条真正的求助，进协作推荐与健康度）
//   completed  —— 做完了（自动提交待验收，由人来判）
//   failed     —— 做不成（任务仍挂在它名下，等人决定重试还是自己上）
//
// 刻意不让 agent 自己判「完成」：completed 只意味着「我交了」，
// 与既有任务状态机一致——判断做没做对的权力在组长或教师手里。
export async function POST(req: Request) {
  const agentUserId = await authenticateBearer(req);
  if (!agentUserId) return unauthorized();

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const run = await reportAgentRun(agentUserId, parsed.data);
    return NextResponse.json({
      id: run.id,
      status: run.status,
      taskId: parsed.data.taskId,
    });
  } catch (e) {
    return mapAgentError(e, "[/api/agent/runs]");
  }
}
