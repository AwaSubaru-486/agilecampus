import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, mapAgentError, unauthorized } from "@/lib/agent-auth";
import { getTaskTree } from "@/lib/task-tree";

type Ctx = { params: Promise<{ projectId: string }> };

// Agent/automation 只读任务树：沿用项目成员权限，不暴露待处理草案之外的私有项目数据。
export async function GET(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();
  const { projectId: raw } = await ctx.params;
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "projectId 无效" }, { status: 400 });

  try {
    const tree = await getTaskTree(userId, parsed.data);
    return NextResponse.json({
      projectId: parsed.data,
      stages: tree.stages,
      tasks: tree.tasks,
      drafts: tree.drafts,
      integrations: tree.integrations,
      deliveries: tree.deliveries,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mapAgentError(error, "[GET /api/agent/projects/:id/task-tree]");
  }
}
