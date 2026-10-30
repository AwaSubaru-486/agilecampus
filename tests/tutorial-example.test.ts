import { describe, it, expect } from "vitest";
import { buildWelcomeSteps, EMPTY_JOURNEY, welcomeResumeIndex } from "@/lib/tutorials/example-flow";
import { findShowcaseProject } from "@/lib/tutorials/showcase";

const journey = { version: 6 as const, teamId: "demo-team", projectId: "demo-project", taskId: "first-task", role: "admin" as const };
describe("汪汪队项目展示路线", () => {
  it("使用同一已有项目，查看即可学习，没有创建、发布或交付门槛", () => {
    const steps = buildWelcomeSteps(journey);
    expect(steps[0].route).toBe("/tutorials");
    expect(steps[1].route).toBe("/teams/demo-team/members");
    expect(steps.filter(step => step.route.startsWith("/projects/")).every(step => step.route.startsWith("/projects/demo-project"))).toBe(true);
    expect(steps.some(step => ["team", "project", "generate", "publish", "claim", "submit"].includes(step.id))).toBe(false);
    expect(steps.filter(step => step.action === "result").every(step => step.target === '[data-tour="project-view-switch"]')).toBe(true);
    expect(steps.find(step => step.id === "select")?.route).toBe("/projects/demo-project?space=work&scope=all&task=first-task&panel=list");
    expect(steps.find(step => step.id === "delivery")?.action).toBe("explore");
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
  });
  it("按照真实角色显示课程，组员不进入记录，老师不进入执行和 AI", () => {
    const member = buildWelcomeSteps({ ...journey, role: "student" });
    const teacher = buildWelcomeSteps({ ...journey, role: "teacher" });
    expect(member.some(step => ["records", "activity", "assignments", "member-view", "review"].includes(step.id))).toBe(false);
    expect(teacher.some(step => ["select", "delivery", "ai", "board", "member-view"].includes(step.id))).toBe(false);
    expect(teacher.some(step => step.id === "integration")).toBe(true);
    expect(member.find(step => step.id === "select")?.route).not.toContain("scope=all");
  });
  it("刷新后重新打开任务小界面，其他步骤从原位置恢复", () => {
    for (const role of ["admin", "student", "teacher"] as const) {
      const current = { ...journey, role };
      const steps = buildWelcomeSteps(current);
      const index = (id: string) => steps.findIndex(step => step.id === id);
      expect(welcomeResumeIndex(index("timeline-detail"), current)).toBe(index("timeline-node"));
      expect(welcomeResumeIndex(index("timeline-close"), current)).toBe(index("timeline-node"));
      expect(welcomeResumeIndex(index("stages"), current)).toBe(index("stages"));
    }
    expect(buildWelcomeSteps(EMPTY_JOURNEY)[0].target).toBe('[data-tour="tutorial-showcase"]');
  });
  it("只在可访问的汪汪队项目中选择有任务的一份，不误选同名空项目", () => {
    const project = { id: "full", name: "敏捷开发平台", teamId: "team", teamName: "汪汪队", role: "admin" as const, taskTotal: 42 };
    expect(findShowcaseProject([{ ...project, id: "empty", taskTotal: 0 }, { ...project, id: "other", teamName: "其他团队", taskTotal: 99 }, project])?.id).toBe("full");
    expect(findShowcaseProject([{ ...project, teamName: "其他团队" }])).toBeNull();
  });
});
