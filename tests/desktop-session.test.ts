import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const source = vi.hoisted(() => ({ listOwned: vi.fn(), getOwned: vi.fn(), readAssetOwned: vi.fn() }));
vi.mock("@/lib/pets/home-pet-source", () => ({ homePetSource: source }));
import { db } from "@/db";
import { desktopPetConnections, users } from "@/db/schema";
import { authenticateDesktop, commandDesktop, consumeDesktopPairing, createDesktopPairing, desktopHeartbeat, desktopServerOrigin, desktopState, desktopStatus } from "@/lib/pets/desktop-session";
import { desktopImageMime, readDesktopAsset } from "@/lib/pets/desktop-asset";
import { ensureHome, selectHomePet } from "@/lib/home";
import { resetDb } from "./helpers";
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/q1sAAAAASUVORK5CYII=", "base64");
async function owner() { const [user] = await db.insert(users).values({ email: "pet-desktop@test.local", name: "桌宠测试" }).returning(); return user.id; }
async function connect(id: string) {
  const invitation = await createDesktopPairing(id, "http://127.0.0.1:3000");
  const ticket = new URL(invitation.launchUrl).searchParams.get("ticket")!;
  const session = await consumeDesktopPairing(ticket);
  const request = new Request("http://localhost/api/home/desktop/state", { headers: { authorization: `Bearer ${session.token}` } });
  return { invitation, ticket, session, request, record: await authenticateDesktop(request) };
}
describe("独立桌面陪伴的连接与权限", () => {
  beforeEach(async () => { await resetDb(); vi.clearAllMocks(); source.getOwned.mockResolvedValue(null); source.listOwned.mockResolvedValue([]); source.readAssetOwned.mockResolvedValue(null); });
  it("只接受 HTTPS 或回环服务地址", () => {
    expect(desktopServerOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(() => desktopServerOrigin("http://other.test")).toThrow();
    expect(() => desktopServerOrigin("https://user:pass@test/")).toThrow();
  });
  it("邀请只能使用一次，数据库不保存明文邀请和凭据", async () => {
    const id = await owner(); const { ticket, session } = await connect(id);
    await expect(consumeDesktopPairing(ticket)).rejects.toThrow("已使用");
    const [stored] = await db.select().from(desktopPetConnections);
    expect(JSON.stringify(stored)).not.toContain(ticket);
    expect(JSON.stringify(stored)).not.toContain(session.token);
  });
  it("过期邀请不可领取", async () => {
    const id = await owner(); const invitation = await createDesktopPairing(id, "http://localhost:3000");
    await db.update(desktopPetConnections).set({ pairingExpiresAt: new Date(0) }).where(eq(desktopPetConnections.id, invitation.connectionId));
    await expect(consumeDesktopPairing(new URL(invitation.launchUrl).searchParams.get("ticket")!)).rejects.toThrow("过期");
  });
  it("并发领取仅一个成功；新的连接撤销旧连接", async () => {
    const id = await owner(); const first = await connect(id);
    const invitation = await createDesktopPairing(id, "http://localhost:3000");
    const ticket = new URL(invitation.launchUrl).searchParams.get("ticket")!;
    const results = await Promise.allSettled([consumeDesktopPairing(ticket), consumeDesktopPairing(ticket)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    await expect(authenticateDesktop(first.request)).rejects.toThrow("失效");
  });
  it("仅在实际客户端回执后报告运行，过期心跳不显示在线", async () => {
    const id = await owner(); const connected = await connect(id);
    expect((await desktopStatus(id)).connected).toBe(false);
    await desktopHeartbeat(connected.record, "visible");
    expect(await desktopStatus(id)).toMatchObject({ connected: true, status: "visible" });
    await db.update(desktopPetConnections).set({ lastSeenAt: new Date(0) }).where(eq(desktopPetConnections.id, connected.record.id));
    expect((await desktopStatus(id)).connected).toBe(false);
  });
  it("显示命令按序确认；断开连接后独立凭据失效", async () => {
    const id = await owner(); const connected = await connect(id);
    await desktopHeartbeat(connected.record, "hidden");
    await commandDesktop(id, "show");
    const current = await authenticateDesktop(connected.request);
    expect((await desktopState(current)).command).toEqual({ action: "show", sequence: 1 });
    await desktopHeartbeat(current, "visible", 1);
    expect((await desktopState(await authenticateDesktop(connected.request))).command).toBeNull();
    await expect(desktopHeartbeat(current, "visible", 3)).rejects.toThrow("尚未发送");
    await commandDesktop(id, "disconnect");
    await expect(authenticateDesktop(connected.request)).rejects.toThrow("失效");
  });
  it("状态只读取本人的当前桌宠，未绑定保持明确空态", async () => {
    const id = await owner(); const connected = await connect(id);
    expect(await desktopState(connected.record)).toMatchObject({ status: "unbound", pet: null });
    const pet = { id: "custom:one", ownerId: id, name: "测试桌宠", appearance: { type: "image", src: "/api/pets/one/image", width: 96, height: 96 } };
    source.getOwned.mockResolvedValue(pet); await selectHomePet(id, pet.id);
    expect((await desktopState(connected.record)).pet?.id).toBe(pet.id);
    source.readAssetOwned.mockResolvedValue({ bytes: pixel, mimeType: "image/png" });
    expect((await readDesktopAsset(id)).bytes).toEqual(pixel);
    source.getOwned.mockResolvedValue({ ...pet, ownerId: "22222222-2222-4222-8222-222222222222" });
    await expect(desktopState(connected.record)).rejects.toThrow("不属于");
  });
  it("独立凭据不会被网页登录接口当成 session；资源不接收 HTML 或伪造格式", async () => {
    const id = await owner(); await ensureHome(id);
    await expect(authenticateDesktop(new Request("http://localhost", { headers: { authorization: "Bearer ac_fake_project_token" } }))).rejects.toThrow("失效");
    expect(() => desktopImageMime(Buffer.from("<script>bad</script>"))).toThrow("只接收");
    expect(desktopImageMime(pixel)).toBe("image/png");
  });
});
