import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), set: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/project", () => ({ getProjectForUser: mocks.access }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { resolveProjectView } from "@/lib/project-view";
import { setProjectView } from "@/app/(app)/projects/[projectId]/_shared/project-view-actions";

describe("角色界面预览权限", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); mocks.access.mockResolvedValue({ role: "admin" }); });
  const project = "11111111-1111-4111-8111-111111111111";
  it("仅组长可切换，普通成员伪造预览值也不能改变视角", () => {
    expect(resolveProjectView("admin", "teacher")).toBe("teacher");
    expect(resolveProjectView("admin", "student")).toBe("student");
    expect(resolveProjectView("student", "admin")).toBe("student");
    expect(resolveProjectView("teacher", "student")).toBe("teacher");
    expect(resolveProjectView("admin", "unknown")).toBe("admin");
  });
  it("只写当前项目的界面偏好，刷新项目页，不修改团队角色", async () => {
    expect(await setProjectView(project, "teacher")).toEqual({ error: null });
    expect(mocks.set).toHaveBeenCalledWith(`project-view-${project}`, "teacher", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: `/projects/${project}` }));
    expect(mocks.revalidate).toHaveBeenCalledWith(`/projects/${project}`, "layout");
  });
  it("未登录、组员、非法项目和视角不保存偏好", async () => {
    mocks.access.mockResolvedValue({ role: "student" });
    expect((await setProjectView(project, "teacher")).error).toBeTruthy();
    mocks.auth.mockResolvedValue(null);
    expect((await setProjectView(project, "teacher")).error).toBeTruthy();
    expect((await setProjectView("bad", "admin")).error).toBeTruthy();
    expect((await setProjectView(project, "root")).error).toBeTruthy();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
