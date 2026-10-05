import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { reviewTask } from "@/lib/task";

const schema = z.object({
  taskId: z.uuid(),
  decision: z.enum(["accept", "reject"]),
  note: z.string().trim().optional(),
});

// CC 写入：验收任务——通过则落 done，退回则回 doing 并计入一次返工。
// 主体是组长或教师（lib 内 requireTaskReview 收口）；学生调用返回 403。
// 退回必附理由，否则成员只知道被否了、不知道改什么。
export async function POST(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const task = await reviewTask(userId, parsed.data.taskId, {
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
    return NextResponse.json({
      id: task.id,
      status: task.status,
      rejectCount: task.rejectCount,
    });
  } catch (e) {
    return mapAgentError(e, "[/api/agent/tasks/review]");
  }
}
