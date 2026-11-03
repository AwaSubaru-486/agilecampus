import type { HomePetProvider } from "./home-pet-contract";
import { demoHomePet } from "./home-demo-pet";

/**
 * Server-side integration point for the teammate's custom-pet module.
 * Replace these readers with its ownership-scoped queries. Return null for
 * deleted/inaccessible pets. The temporary demo is opt-in via HOME_DEMO_PET_ENABLED.
 * Remove the demo calls when connecting the teammate's pet service.
 */
export const homePetSource: HomePetProvider = {
  async listOwned(ownerId) { const pet = demoHomePet(ownerId); return pet ? [pet] : []; },
  async getOwned(ownerId, petId) { const pet = demoHomePet(ownerId); return pet?.id === petId ? pet : null; },
};
