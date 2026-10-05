import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { getHandoff } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ handoffId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { handoffId } = await ctx.params;
    if (!z.string().uuid().safeParse(handoffId).success) {
      return NextResponse.json({ error: "handoffId 无效" }, { status: 400 });
    }

    const handoff = await getHandoff(actorId, handoffId);
    return NextResponse.json(handoff);
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/handoffs/[handoffId]");
  }
}
