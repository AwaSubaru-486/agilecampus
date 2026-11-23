import { readWebPetConfig, readWebPetAsset, webPetAssetKey, webPetId } from "./web-pet-config";
import type { HomePetDefinition } from "./home-pet-contract";

export async function currentWebHomePet(ownerId: string): Promise<HomePetDefinition> {
  const config = await readWebPetConfig(ownerId);
  return { id: webPetId(ownerId), ownerId, name: config.name,
    appearance: { type: "image", src: `/api/pets/web/${ownerId}/${webPetAssetKey(config)}`, ...(config.preset !== "custom" ? { greetSrc: `/api/pets/web/${ownerId}/${webPetAssetKey(config)}-greet` } : {}), width: 256, height: 256 } };
}
export async function webHomeAsset(ownerId: string, petId: string) {
  if (petId !== webPetId(ownerId)) return null;
  const asset = await readWebPetAsset(ownerId);
  return asset && "bytes" in asset ? asset : null;
}
