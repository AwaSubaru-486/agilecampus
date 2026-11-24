import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), operation: vi.fn(), bind: vi.fn(), memory: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/project-operation", () => ({ runProjectOperation: mocks.operation }));
vi.mock("@/lib/task-material", () => ({ bindTaskContextPack: mocks.bind }));
vi.mock("@/lib/project-memory", () => ({ createProjectMemory: mocks.memory }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { ForbiddenError } from "@/lib/errors";
import { addTaskMemoryAction, bindTaskMaterialAction } from "@/app/(app)/projects/[projectId]/_console/material-actions";

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries({ projectId, taskId, ...values })) data.set(key, value); return data; }
describe("网页资料操作鉴权", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "real-actor" } });
    mocks.operation.mockImplementation(async (actorId, _projectId, _action, execute) => execute(actorId));
  });
  it("失效的视角不允许写入资料和记忆", async () => {
    mocks.operation.mockRejectedValue(new ForbiddenError("视角失效，请重新切换"));
    expect(await bindTaskMaterialAction(null, form({ contextPackId: "" }))).toHaveProperty("error", expect.stringContaining("视角失效"));
    expect(await addTaskMemoryAction(null, form({ category: "decision", title: "依据", content: "结论" }))).toHaveProperty("error", expect.stringContaining("视角失效"));
    expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.memory).not.toHaveBeenCalled();
  });
  it("未登录和无项目权限不会调用写入", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await bindTaskMaterialAction(null, form({ contextPackId: "" }))).toHaveProperty("error", "请先登录");
    mocks.auth.mockResolvedValue({ user: { id: "real-actor" } }); mocks.operation.mockRejectedValue(new ForbiddenError("无权访问该项目"));
    expect(await addTaskMemoryAction(null, form({ category: "decision", title: "依据", content: "结论" }))).toHaveProperty("error", "无权访问该项目");
    expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.memory).not.toHaveBeenCalled();
  });
  it("空选择明确解除绑定，使用真实身份并刷新项目", async () => {
    expect(await bindTaskMaterialAction(null, form({ contextPackId: "" }))).toEqual({ ok: true });
    expect(mocks.bind).toHaveBeenCalledWith("real-actor", projectId, taskId, null);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/projects/${projectId}`);
  });
  it("非法资料标识和空记忆在写入前被拒绝", async () => {
    expect(await bindTaskMaterialAction(null, form({ contextPackId: "wrong" }))).toHaveProperty("error");
    expect(await addTaskMemoryAction(null, form({ category: "decision", title: " ", content: "结论" }))).toHaveProperty("error");
    expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.memory).not.toHaveBeenCalled();
  });
  it("记忆使用真实身份并自动关联任务", async () => {
    expect(await addTaskMemoryAction(null, form({ category: "decision", title: " 依据 ", content: " 结论 " }))).toEqual({ ok: true });
    expect(mocks.memory).toHaveBeenCalledWith("real-actor", projectId, { taskId, category: "decision", title: "依据", content: "结论" });
  });
});
