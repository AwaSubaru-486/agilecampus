import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { getCheckpoint } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ checkpointId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { checkpointId } = await ctx.params;
    if (!z.string().uuid().safeParse(checkpointId).success) {
      return NextResponse.json({ error: "checkpointId 无效" }, { status: 400 });
    }

    const checkpoint = await getCheckpoint(actorId, checkpointId);
    return NextResponse.json(checkpoint);
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/checkpoints/[checkpointId]");
  }
}
