import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { listProjectHandoffRecipients } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ projectId: string }> };

/** List current human recipients; the service rechecks caller membership on every request. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { projectId } = await ctx.params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }

    const items = await listProjectHandoffRecipients(actorId, projectId);
    return NextResponse.json(
      { projectId, items },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/projects/[projectId]/members");
  }
}
