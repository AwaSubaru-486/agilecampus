import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), saveHome: vi.fn(), moveHomePet: vi.fn(), setHomeWorking: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/home", () => ({ saveHome: mocks.saveHome, moveHomePet: mocks.moveHomePet, setHomeWorking: mocks.setHomeWorking }));
import { POST } from "@/app/api/home/route";

function request(origin = "http://127.0.0.1:3000") {
  return new Request("http://localhost:3000/api/home", {
    method: "POST", headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" },
    body: JSON.stringify({ operation: "move", teamId: null }),
  });
}
describe("家园浏览器写入接口", () => {
  it("项目开工传递精确项目并拒绝无效项目 ID", async () => {
    const teamId = "a5f9a20d-6acf-4b3a-944e-2ba11b0762a4", projectId = "e3846bee-a320-4d71-a63a-af351d54ef1a";
    const post = (projectId: string) => POST(new Request("http://localhost:3000/api/home", { method: "POST", body: JSON.stringify({ operation: "work", teamId, projectId }) }));
    expect((await post(projectId)).status).toBe(200);
    expect(mocks.setHomeWorking).toHaveBeenCalledWith("owner", teamId, projectId);
    expect((await post("invalid")).status).toBe(400);
    expect(mocks.setHomeWorking).toHaveBeenCalledTimes(1);
  });
  it("工作状态仅写入当前登录成员，忽略伪造 ownerId", async () => {
    mocks.setHomeWorking.mockResolvedValue({ workingTeamId: null });
    const response = await POST(new Request("http://localhost:3000/api/home", { method: "POST", body: JSON.stringify({ operation: "work", teamId: null, ownerId: "someone-else" }) }));
    expect(response.status).toBe(200);
    expect(mocks.setHomeWorking).toHaveBeenCalledWith("owner", null);
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); mocks.moveHomePet.mockResolvedValue({ ownerId: "owner", petTeamId: null }); });
  it("使用请求 Host 校验来源，允许浏览器 127.0.0.1 与 Next 内部 localhost 的正常请求", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.moveHomePet).toHaveBeenCalledWith("owner", null);
  });
  it("拒绝来自其他网站的写入", async () => {
    expect((await POST(request("https://untrusted.example"))).status).toBe(403);
    expect(mocks.moveHomePet).not.toHaveBeenCalled();
  });
  it("拒绝未登录写入", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
  });
  it("拒绝无效的庭院 ID", async () => {
    const response = await POST(new Request("http://localhost:3000/api/home", { method: "POST", body: JSON.stringify({ operation: "move", teamId: "invalid" }) }));
    expect(response.status).toBe(400);
    expect(mocks.moveHomePet).not.toHaveBeenCalled();
  });
});
