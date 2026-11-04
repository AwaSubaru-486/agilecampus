import type { HomePetDefinition } from "./home-pet-contract";

/** Explicitly enabled shared demo template, not a user-created pet or seed account. */
export function demoHomePet(ownerId: string): HomePetDefinition | null {
  if (process.env.HOME_DEMO_PET_ENABLED !== "true") return null;
  return { id: `demo:qing-bot:${ownerId}`, ownerId, name: "小青（演示）",
    appearance: { type: "image", src: "/pets/demo/qing-bot.png", width: 1214, height: 1295 } };
}
