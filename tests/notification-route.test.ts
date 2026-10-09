import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), dismiss: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/task-notifications", () => ({ dismissTaskNotification: mocks.dismiss, listTaskNotifications: mocks.list }));
import { GET, POST } from "@/app/api/notifications/route";

describe("通知接口登录与来源校验", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "current-user" } }); });
  const id = "11111111-1111-4111-8111-111111111111";
  function request(origin: string) {
    return new Request("http://localhost:3106/api/notifications", {
      method: "POST", headers: { host: "127.0.0.1:3106", origin, "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
  }
  it("支持浏览器使用 127.0.0.1 而内部请求地址是 localhost", async () => {
    expect((await POST(request("http://127.0.0.1:3106"))).status).toBe(200);
    expect(mocks.dismiss).toHaveBeenCalledWith("current-user", id);
  });
  it("拒绝外站来源，不确认任何通知", async () => {
    expect((await POST(request("https://other.example"))).status).toBe(403);
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
  it("未登录不能读取或确认", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request("http://127.0.0.1:3106"))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
});
