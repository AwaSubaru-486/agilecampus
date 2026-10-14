import { describe, expect, it } from "vitest";
import { isProjectHome, projectTaskScope, PROJECT_ROLE_WORKSPACE } from "@/lib/project-role-workspace";

describe("角色项目入口", () => {
  it("缺省入口展示角色首页，任务和会话深链仍进入原工作区", () => {
    expect(isProjectHome({})).toBe(true);
    expect(isProjectHome({ space: "home" })).toBe(true);
    for (const params of [{ task: "task" }, { conversation: "chat" }, { approval: "approval" }, { space: "work" }, { view: "board" }, { scope: "all" }, { priority: "high" }]) expect(isProjectHome(params)).toBe(false);
  });
  it("组员和组长默认本人任务，老师始终仅展示已完成成果", () => {
    expect(projectTaskScope("student", null)).toBe("mine");
    expect(projectTaskScope("teacher", null)).toBe("completed");
    expect(projectTaskScope("teacher", "all")).toBe("completed");
    expect(projectTaskScope("admin", null)).toBe("mine");
    expect(projectTaskScope("admin", "all")).toBe("all");
    expect(projectTaskScope("admin", "review")).toBe("review");
    expect(projectTaskScope("admin", "completed")).toBe("completed");
    expect(projectTaskScope("student", "review")).toBe("mine");
    expect(projectTaskScope("teacher", "review")).toBe("completed");
    expect(projectTaskScope("student", "all")).toBe("all");
    expect(PROJECT_ROLE_WORKSPACE.teacher.studio).toBeNull();
    expect(PROJECT_ROLE_WORKSPACE.student.title).toBe("看板");
    expect(PROJECT_ROLE_WORKSPACE.student.iterations).toBe("时间线");
  });
});
