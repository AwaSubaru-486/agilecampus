import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
import { webPetActor, webPetRuntime } from "@/lib/pets/web-pet-security";
import { POST as control } from "@/app/api/desktop-pet/control/route";
import { GET as image } from "@/app/api/desktop-pet/image/route";
import { GET as status } from "@/app/api/desktop-pet/status/route";
import { GET as sync } from "@/app/api/desktop-pet/sync/route";
import { POST as reply } from "@/app/api/desktop-pet/reply/route";

function request(body = "{}", origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/desktop-pet/control", { method: "POST", headers: { origin }, body });
}
describe("网页桌宠合并安全边界", () => {
  beforeEach(() => { mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ user: { id: "alice" } }); });
  it("所有接口在访问文件或通知前要求登录", async () => {
    mocks.auth.mockResolvedValue(null);
    for (const response of await Promise.all([control(request()), reply(request()), status(), sync(), image(new Request("http://localhost/api/desktop-pet/image?path=.env"))])) {
      expect(response.status).toBe(401);
    }
  });
  it("禁止跨站写入", async () => {
    expect((await control(request("{}", "https://evil.example"))).status).toBe(403);
    expect((await reply(request("{}", "https://evil.example"))).status).toBe(403);
    expect(await webPetActor(request())).toBe("alice");
  });
  it("以账号隔离目录，账号字符串不能改变目录结构", () => {
    expect(webPetRuntime("alice")).not.toBe(webPetRuntime("bob"));
    expect(webPetRuntime("../../other")).toMatch(/web-pets\/[a-f0-9]{64}$/);
  });
  it("拒绝无效或过大的请求体", async () => {
    for (const body of ["null", "[]", "{"]) expect((await control(request(body))).status).toBe(400);
    expect((await control(request(JSON.stringify({ message: "a".repeat(33000) })))).status).toBe(413);
  });
  it("不能读取服务器绝对路径、file URL 或目录外文件", async () => {
    for (const value of ["/etc/passwd", "file:///etc/passwd", "C:\\secret.txt"]) {
      expect((await image(new Request(`http://localhost/api/desktop-pet/image?path=${encodeURIComponent(value)}`))).status).toBe(400);
    }
    expect((await image(new Request("http://localhost/api/desktop-pet/image?path=../package.json"))).status).toBe(403);
  });
  it("仍能读取已提交的 public 图片，但不公开缓存", async () => {
    const response = await image(new Request("http://localhost/api/desktop-pet/image?path=desk-pet/puppy.png"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
