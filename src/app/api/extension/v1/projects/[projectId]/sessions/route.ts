import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, mapExtensionError, unauthorized } from "@/lib/extension-auth";
import { listSessionMemoryPublications } from "@/lib/session-memory/access";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const actorId = await authenticateBearer(req);
  if (!actorId) return unauthorized();

  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") ?? undefined;
  if (taskId && !z.uuid().safeParse(taskId).success) {
    return NextResponse.json({ error: "taskId 无效" }, { status: 400 });
  }
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    return NextResponse.json({ error: "limit 必须为 1 到 50 的整数" }, { status: 400 });
  }

  try {
    const result = await listSessionMemoryPublications(actorId, projectId, {
      taskId,
      cursor: searchParams.get("cursor") ?? undefined,
      limit,
    });
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/projects/[projectId]/sessions");
  }
}
