import type { HomePetProvider } from "./home-pet-contract";

/**
 * Server-side integration point for the teammate's custom-pet module.
 * Replace these readers with its ownership-scoped queries. Return null for
 * deleted/inaccessible pets. No demo assets, credentials or pet creation live here.
 */
export const homePetSource: HomePetProvider = {
  async listOwned(ownerId) { void ownerId; return []; },
  async getOwned(ownerId, petId) { void ownerId; void petId; return null; },
};
