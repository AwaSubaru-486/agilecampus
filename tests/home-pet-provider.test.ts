import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const source = vi.hoisted(() => ({ listOwned: vi.fn(), getOwned: vi.fn() }));
vi.mock("@/lib/pets/home-pet-source", () => ({ homePetSource: source }));
import { homePetDefinitionSchema } from "@/lib/pets/home-pet-contract";
import { listHomePets, resolveHomePet } from "@/lib/pets/home-pet-provider";
import { HomePetAvatar } from "@/components/pets/home-pet-avatar";
import { createElement } from "react";
const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const pet = { id: "custom:one", ownerId, name: "队友的自定义桌宠", appearance: { type: "image" as const, src: "/api/pets/one/image", width: 128, height: 192 } };

describe("自定义桌宠接入契约", () => {
  beforeEach(() => vi.clearAllMocks());
  it("接口未接入时可返回空列表，不捏造桌宠", async () => {
    source.listOwned.mockResolvedValue([]);
    expect(await listHomePets(ownerId)).toEqual([]);
  });
  it("只接受所有权与请求 ID 匹配的资源", async () => {
    source.getOwned.mockResolvedValue(pet);
    expect((await resolveHomePet(ownerId, pet.id))?.name).toBe(pet.name);
    await expect(resolveHomePet(otherId, pet.id)).rejects.toThrow("不属于");
    await expect(resolveHomePet(ownerId, "wrong-id")).rejects.toThrow("不属于");
    source.listOwned.mockResolvedValue([{ ...pet, ownerId: otherId }]);
    await expect(listHomePets(ownerId)).rejects.toThrow("其他成员");
  });
  it("限制资源地址，不接收外部脚本、跨站地址和路径穿越", () => {
    for (const src of ["https://untrusted.test/pet.png", "//untrusted.test/pet.png", "javascript:alert(1)", "/pets/../secret", "/pets/%2e%2e/secret", "/pets/%252e%252e/secret", "/pets/a\\b.png"])
      expect(homePetDefinitionSchema.safeParse({ ...pet, appearance: { ...pet.appearance, src } }).success).toBe(false);
  });
  it("精灵图帧定义必须在图集范围内", () => {
    const appearance = { type: "spritesheet", src: "/pets/sheet.webp", frameWidth: 64, frameHeight: 96, columns: 4, rows: 2, idle: { start: 0, count: 4, fps: 8 }, greet: { start: 4, count: 4, fps: 10 } };
    expect(homePetDefinitionSchema.safeParse({ ...pet, appearance }).success).toBe(true);
    expect(homePetDefinitionSchema.safeParse({ ...pet, appearance: { ...appearance, greet: { start: 6, count: 4, fps: 10 } } }).success).toBe(false);
  });
  it("静态图片由独立组件绘制，未绑定时只显示中性占位", () => {
    const html = renderToStaticMarkup(createElement(HomePetAvatar, { pet: { name: pet.name, kind: "placeholder", petId: pet.id, status: "ready", definition: pet } }));
    expect(html).toContain('href="/api/pets/one/image"');
    expect(html).toContain('data-pet-state="ready"');
    const empty = renderToStaticMarkup(createElement(HomePetAvatar, { pet: { name: "未选择桌宠", kind: "placeholder", status: "unbound", definition: null } }));
    expect(empty).toContain('data-pet-state="unbound"');
    expect(empty).not.toContain("<image");
  });
  it("精灵图打招呼使用对应帧区间，资源按帧底部中点对齐", () => {
    const definition = homePetDefinitionSchema.parse({ ...pet, appearance: { type: "spritesheet", src: "/pets/sheet.webp", frameWidth: 64, frameHeight: 96, columns: 4, rows: 2, idle: { start: 0, count: 4, fps: 8 }, greet: { start: 4, count: 4, fps: 8 } } });
    const html = renderToStaticMarkup(createElement(HomePetAvatar, { action: "greet", pet: { name: pet.name, kind: "placeholder", petId: pet.id, status: "ready", definition } }));
    expect(html).toContain('y="-96"');
    expect(html).toContain('preserveAspectRatio="xMidYMax meet"');
  });
});
