import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/app/(app)/projects/[projectId]/_shared/project-view-actions", () => ({ setProjectView: mocks.set }));
import { POST } from "@/app/api/projects/[projectId]/view/route";
const projectId = "11111111-1111-4111-8111-111111111111";
const base = `/projects/${projectId}`;
function request(returnTo: string, origin = "http://127.0.0.1:3106", view = "teacher:44444444-4444-4444-8444-444444444444") {
  return new Request(`http://127.0.0.1:3106/api/projects/${projectId}/view`, { method: "POST", headers: { host: "127.0.0.1:3106", origin }, body: new URLSearchParams({ view, returnTo }) });
}
const context = { params: Promise.resolve({ projectId }) };
describe("视角切换返回地址", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.set.mockResolvedValue({ error: null }); });
  it("切换后返回当前项目的当前页面", async () => {
    const result = await POST(request(`${base}/timeline?diagram=schedule`), context);
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(`${base}/timeline?diagram=schedule`);
  });
  it("内部 localhost 请求也保留浏览器 Host，不导致跨主机掉登录", async () => {
    const req = request(base);
    const internal = new Request(`http://localhost:3106/api/projects/${projectId}/view`, { method: "POST", headers: req.headers, body: new URLSearchParams({ view: "teacher", returnTo: base }) });
    expect((await POST(internal, context)).headers.get("location")).toBe(base);
  });
  it("不跳转外站、其他项目或相似路径", async () => {
    for (const target of ["https://evil.example", "/projects/other", `${base}-fake`]) expect((await POST(request(target), context)).headers.get("location")).toBe(base);
  });
  it("切换具体组员时清除上一个人的任务，并返回新成员的我的任务", async () => {
    const view = "student:22222222-2222-4222-8222-222222222222";
    const result = await POST(request(`${base}?space=work&scope=all&task=old&run=old-run&assignee=old-owner&panel=list`, "http://127.0.0.1:3106", view), context);
    expect(mocks.set).toHaveBeenCalledWith(projectId, view);
    const destination = new URL(result.headers.get("location")!, "http://127.0.0.1:3106");
    expect(destination.searchParams.get("scope")).toBe("mine");
    expect(destination.searchParams.get("panel")).toBe("list");
    for (const key of ["task", "run", "assignee"]) expect(destination.searchParams.has(key)).toBe(false);
  });
  it("拒绝外站提交和权限失败", async () => {
    expect((await POST(request(base, "https://evil.example"), context)).status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.set.mockResolvedValue({ error: "只有组长可以切换" });
    expect((await POST(request(base), context)).status).toBe(403);
  });
});
