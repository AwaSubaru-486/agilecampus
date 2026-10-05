import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { updateTask } from "@/lib/task";

const schema = z.object({
  taskId: z.uuid(),
  completionNote: z.string().min(1),
});

// CC 写入：提交成果——落入「待验收」并附完成说明。lib 校验写权限。
//
// 此前此处硬跳 done。引入验收档后改为提交语义：判断完成的权力归组长或教师，
// 外部程序不能替人自证。CC 侧的「完成任务」因此变成「提交待验收」，
// 验收走 POST /api/agent/tasks/review。
export async function POST(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const task = await updateTask(userId, parsed.data.taskId, {
      status: "review",
      completionNote: parsed.data.completionNote,
    });
    return NextResponse.json({ id: task.id, status: task.status });
  } catch (e) {
    return mapAgentError(e, "[/api/agent/tasks/complete]");
  }
}
