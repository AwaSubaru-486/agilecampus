import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { listTaskAttempts } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ projectId: string; taskId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { projectId, taskId } = await ctx.params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }
    if (!z.string().uuid().safeParse(taskId).success) {
      return NextResponse.json({ error: "taskId 无效" }, { status: 400 });
    }

    const attempts = await listTaskAttempts(actorId, projectId, taskId);
    return NextResponse.json(
      { attempts },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/.../attempts");
  }
}
