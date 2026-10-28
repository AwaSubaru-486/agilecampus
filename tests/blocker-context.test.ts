import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/task", () => ({ listProjectTasks: vi.fn() }));
vi.mock("@/lib/collaboration", () => ({ suggestHelpers: vi.fn() }));
import { auth } from "@/lib/auth";
import { listProjectTasks } from "@/lib/task";
import { suggestHelpers } from "@/lib/collaboration";
import { GET } from "@/app/api/me/blocker-context/route";

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { vi.resetAllMocks(); });
describe("help context scoping", () => {
  it("keeps an explicitly selected project task available without listing every teammate task", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "me" } } as never);
    vi.mocked(listProjectTasks).mockResolvedValue([
      { id: taskId, title: "当前任务", status: "todo", assigneeId: "other" },
      { id: "other", title: "其他成员任务", status: "doing", assigneeId: "other" },
      { id: "mine", title: "我的任务", status: "doing", assigneeId: "me" },
    ] as never);
    const response = await GET(new Request(`http://localhost/api/me/blocker-context?projectId=${projectId}&taskId=${taskId}`));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).tasks).toEqual([{ id: taskId, title: "当前任务" }, { id: "mine", title: "我的任务" }]);
    expect(suggestHelpers).not.toHaveBeenCalled();
  });
  it("reports access failure rather than disguising it as an empty project", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "me" } } as never);
    vi.mocked(listProjectTasks).mockRejectedValue(new Error("forbidden"));
    const response = await GET(new Request(`http://localhost/api/me/blocker-context?projectId=${projectId}`));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "无法读取项目求助信息" });
  });
});
