import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listProjectTasks } from "@/lib/task";
import { isInFlight } from "@/lib/task-status";
import { suggestHelpers } from "@/lib/collaboration";

const querySchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid().optional(),
  // 未选原因时只回任务列表，不算推荐——推荐必须知道卡在什么环节
  reason: z.enum(["tech", "resource", "unclear", "time", "dependency", "other"]).optional(),
});

// 悬浮求助入口的取数端点。
// 读接口用 route 而非 server action，与 /api/conversations/[id] 的既有读法一致。
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get("projectId") ?? "",
    taskId: url.searchParams.get("taskId") ?? undefined,
    reason: url.searchParams.get("reason") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const { projectId, taskId, reason } = parsed.data;

  try {
    // 只列我自己的在办任务：这个入口解决的是「我卡住了」，
    // 报别人的任务是另一回事，不该混进来
    const tasks = (await listProjectTasks(session.user.id, projectId))
      .filter((t) => isInFlight(t.status) && t.assigneeId === session.user.id)
      .map((t) => ({ id: t.id, title: t.title }));

    const helpers = reason
      ? await suggestHelpers(session.user.id, { projectId, taskId: taskId ?? null, reason })
      : [];

    return NextResponse.json({ tasks, helpers });
  } catch {
    // 非成员或项目不存在，一律按无权处理，不泄露存在性
    return NextResponse.json({ tasks: [], helpers: [] });
  }
}
