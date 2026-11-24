import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { listHandoffs } from "@/lib/checkpoint";
import type { HandoffState } from "@/db/schema";

export async function GET(req: Request) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") ?? undefined;
    const state = (searchParams.get("state") as HandoffState) ?? undefined;
    const box = (searchParams.get("box") as "inbox" | "outbox" | "all") ?? "inbox";
    const cursor = searchParams.get("cursor") ?? undefined;
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;

    if (projectId && !z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }

    const page = await listHandoffs(actorId, { projectId, state, box, cursor, limit });
    return NextResponse.json(page);
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/handoffs");
  }
}
