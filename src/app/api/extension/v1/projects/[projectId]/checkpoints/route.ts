import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { listCheckpoints } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { projectId } = await ctx.params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId") ?? undefined;
    const cursor = searchParams.get("cursor") ?? undefined;
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;

    if (taskId && !z.string().uuid().safeParse(taskId).success) {
      return NextResponse.json({ error: "taskId 无效" }, { status: 400 });
    }

    const page = await listCheckpoints(actorId, projectId, taskId, { cursor, limit });
    return NextResponse.json(page);
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/projects/[projectId]/checkpoints");
  }
}
