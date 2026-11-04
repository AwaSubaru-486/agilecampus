import { afterEach, describe, expect, it, vi } from "vitest";
import { demoHomePet } from "@/lib/pets/home-demo-pet";
import { homePetSource } from "@/lib/pets/home-pet-source";
import { homePetDefinitionSchema } from "@/lib/pets/home-pet-contract";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.unstubAllEnvs());
describe("临时演示桌宠", () => {
  it("默认关闭，保留原来的空接口", async () => {
    vi.stubEnv("HOME_DEMO_PET_ENABLED", "false");
    expect(demoHomePet(owner)).toBeNull();
    expect(await homePetSource.listOwned(owner)).toEqual([]);
  });
  it("开启后明确标注演示，使用真实透明图片并符合现有契约", async () => {
    vi.stubEnv("HOME_DEMO_PET_ENABLED", "true");
    const pet = demoHomePet(owner)!;
    expect(homePetDefinitionSchema.safeParse(pet).success).toBe(true);
    expect(pet.name).toContain("演示");
    expect(pet.appearance.src).toBe("/pets/demo/qing-bot.png");
    expect(await homePetSource.getOwned(owner, pet.id)).toEqual(pet);
    expect(await homePetSource.getOwned(other, pet.id)).toBeNull();
  });
});
