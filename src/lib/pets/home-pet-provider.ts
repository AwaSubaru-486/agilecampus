import { AppError, ForbiddenError } from "@/lib/errors";
import { homePetDefinitionSchema, homePetIdSchema, type HomePetDefinition } from "./home-pet-contract";
import { homePetSource } from "./home-pet-source";

/** Validate adapters too, so an integration cannot expose another member's assets. */
export async function listHomePets(ownerId: string): Promise<HomePetDefinition[]> {
  const results = await homePetSource.listOwned(ownerId);
  const pets = results.map(result => homePetDefinitionSchema.parse(result));
  if (pets.some(pet => pet.ownerId !== ownerId)) throw new ForbiddenError("桌宠来源返回了其他成员的资源");
  return [...new Map(pets.map(pet => [pet.id, pet])).values()];
}

export async function resolveHomePet(ownerId: string, petId: string): Promise<HomePetDefinition | null> {
  const value = await homePetSource.getOwned(ownerId, homePetIdSchema.parse(petId));
  if (!value) return null;
  const pet = homePetDefinitionSchema.parse(value);
  if (pet.ownerId !== ownerId || pet.id !== petId) throw new ForbiddenError("这只桌宠不属于当前成员");
  return pet;
}

export async function requireHomePet(ownerId: string, petId: string) {
  const pet = await resolveHomePet(ownerId, petId);
  if (!pet) throw new AppError("这只桌宠暂不可用，请重新选择");
  return pet;
}
