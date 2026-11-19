import type { HomePetProvider } from "./home-pet-contract";
import { demoHomePet } from "./home-demo-pet";
import { currentWebHomePet, webHomeAsset } from "./web-home-pet";

/**
 * Server-side integration point for the teammate's custom-pet module.
 * Reads the teammate's account-scoped web companion config. The stable web ID
 * follows appearance/name changes without resetting office work. Legacy demo
 * bindings remain readable while HOME_DEMO_PET_ENABLED is enabled.
 */
export const homePetSource: HomePetProvider = {
  async listOwned(ownerId) { const demo = demoHomePet(ownerId); return [await currentWebHomePet(ownerId), ...(demo ? [demo] : [])]; },
  async getOwned(ownerId, petId) { const pet = await currentWebHomePet(ownerId); if (pet.id === petId) return pet; const demo = demoHomePet(ownerId); return demo?.id === petId ? demo : null; },
  readAssetOwned: webHomeAsset,
};
