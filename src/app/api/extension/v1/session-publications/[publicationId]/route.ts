import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, mapExtensionError, unauthorized } from "@/lib/extension-auth";
import { getSessionMemoryPublicationForActor } from "@/lib/session-memory/access";

type Ctx = { params: Promise<{ publicationId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const actorId = await authenticateBearer(req);
  if (!actorId) return unauthorized();

  const { publicationId } = await ctx.params;
  if (!z.uuid().safeParse(publicationId).success) {
    return NextResponse.json({ error: "publicationId 无效" }, { status: 400 });
  }

  try {
    const publication = await getSessionMemoryPublicationForActor(actorId, publicationId);
    return NextResponse.json(publication, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/session-publications/[publicationId]");
  }
}
