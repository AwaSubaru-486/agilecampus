import { describe, expect, it } from "vitest";
import { isProjectHome, projectTaskScope, PROJECT_ROLE_WORKSPACE } from "@/lib/project-role-workspace";

describe("角色项目入口", () => {
  it("缺省入口展示角色首页，任务和会话深链仍进入原工作区", () => {
    expect(isProjectHome({})).toBe(true);
    expect(isProjectHome({ space: "home" })).toBe(true);
    for (const params of [{ task: "task" }, { conversation: "chat" }, { approval: "approval" }, { space: "work" }, { view: "board" }, { scope: "all" }, { priority: "high" }]) expect(isProjectHome(params)).toBe(false);
  });
  it("组员默认本人任务，导师默认待验收；查看全部是显式选择", () => {
    expect(projectTaskScope("student", null)).toBe("mine");
    expect(projectTaskScope("teacher", null)).toBe("review");
    expect(projectTaskScope("admin", null)).toBe("all");
    expect(projectTaskScope("student", "all")).toBe("all");
    expect(PROJECT_ROLE_WORKSPACE.teacher.studio).toBeNull();
  });
});
