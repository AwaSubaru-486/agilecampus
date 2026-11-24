import { NextResponse } from "next/server";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { getActorProfile } from "@/lib/checkpoint";

export async function GET(req: Request) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const profile = await getActorProfile(actorId);
    return NextResponse.json(profile);
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/me");
  }
}
