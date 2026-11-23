import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { homeProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getProjectForUser } from "@/lib/project";
import { readWebPetConfig, readWebPetAsset, webPetAssetKey, webPetId } from "@/lib/pets/web-pet-config";

export async function GET(_request: Request, { params }: { params: Promise<{ ownerId: string; assetKey: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response(null, { status: 401 });
  const { ownerId, assetKey } = await params;
  const key = /^([a-f0-9]{24})(-greet)?$/.exec(assetKey);
  if (!z.uuid().safeParse(ownerId).success || !key) return new Response(null, { status: 404 });
  if (session.user.id !== ownerId) {
    const [home] = await db.select({ projectId: homeProfiles.workingProjectId, pet: homeProfiles.pet }).from(homeProfiles).where(eq(homeProfiles.ownerId, ownerId));
    if (!home?.projectId || home.pet.petId !== webPetId(ownerId) || !await getProjectForUser(ownerId, home.projectId) || !await getProjectForUser(session.user.id, home.projectId)) return new Response(null, { status: 403 });
  }
  const config = await readWebPetConfig(ownerId);
  if (webPetAssetKey(config) !== key[1]) return new Response(null, { status: 404 });
  const asset = await readWebPetAsset(ownerId, config, Boolean(key[2]));
  if (!asset) return new Response(null, { status: 404 });
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if ("redirect" in asset) return new Response(null, { status: 302, headers: { ...headers, Location: asset.redirect } });
  return new Response(new Uint8Array(asset.bytes), { headers: { ...headers, "Content-Type": asset.mimeType } });
}
