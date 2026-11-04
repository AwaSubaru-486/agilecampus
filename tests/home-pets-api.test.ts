import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), ensureHome: vi.fn(), selectHomePet: vi.fn(), listHomePets: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/home", () => ({ ensureHome: mocks.ensureHome, selectHomePet: mocks.selectHomePet }));
vi.mock("@/lib/pets/home-pet-provider", () => ({ listHomePets: mocks.listHomePets }));
import { GET, PUT } from "@/app/api/home/pets/route";
const ownerId = "11111111-1111-4111-8111-111111111111";
function request(petId: unknown, origin = "http://127.0.0.1:3000") {
  return new Request("http://localhost:3000/api/home/pets", { method: "PUT", headers: { host: "127.0.0.1:3000", origin }, body: JSON.stringify({ petId, ownerId: "injected-owner" }) });
}
describe("家园桌宠预留 HTTP 接口", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: ownerId } });
    mocks.ensureHome.mockResolvedValue({ pet: { petId: null } }); mocks.listHomePets.mockResolvedValue([]);
    mocks.selectHomePet.mockResolvedValue({ pet: { petId: "custom:one" } });
  });
  it("未接入资源时返回版本化空列表且禁止缓存", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ schemaVersion: 1, pets: [], selectedPetId: null });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.listHomePets).toHaveBeenCalledWith(ownerId);
  });
  it("选择请求从认证取 ownerId，忽略客户端伪造身份", async () => {
    expect((await PUT(request("custom:one"))).status).toBe(200);
    expect(mocks.selectHomePet).toHaveBeenCalledWith(ownerId, "custom:one");
  });
  it("支持清空关联，并拒绝无效 ID", async () => {
    expect((await PUT(request(null))).status).toBe(200);
    expect(mocks.selectHomePet).toHaveBeenCalledWith(ownerId, null);
    expect((await PUT(request("../other-owner"))).status).toBe(400);
  });
  it("拒绝未登录及跨站请求", async () => {
    expect((await PUT(request("custom:one", "https://untrusted.test"))).status).toBe(403);
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await PUT(request(null))).status).toBe(401);
  });
});
