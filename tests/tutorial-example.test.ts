import { describe, it, expect } from "vitest";
import { buildWelcomeSteps, WELCOME_CHAPTERS, WELCOME_VERSION } from "@/lib/tutorials/example-flow";
import { findShowcaseProject, SHOWCASE_TEAM } from "@/lib/tutorials/showcase";

const journey = { version: WELCOME_VERSION, teamId: "demo-team", projectId: "demo-project", taskId: "blocked-task", helpTaskId: "blocked-task", role: "admin" } as const;

describe("敏捷开发平台项目导览", () => {
  it("从项目办公室走到对应的求助、交付和复盘，步骤无需写入业务数据", () => {
    const steps = buildWelcomeSteps(journey);
    expect(steps[0]).toMatchObject({ route: "/projects/demo-project", target: '[data-tour="project-office"]' });
    expect(steps[1].route).toBe("/teams/demo-team/members");
    expect(steps.find(step => step.id === "help")?.route).toBe("/collaboration?project=demo-project&task=blocked-task#task-blocked-task");
    expect(steps.find(step => step.id === "delivery")).toMatchObject({
      route: "/projects/demo-project?space=work&scope=all&task=blocked-task",
      action: "explore",
    });
    expect(steps.at(-1)?.route).toBe("/projects/demo-project/retrospective");
    expect(steps.filter(step => step.action !== "explore").map(step => step.id)).toEqual(["leader-start"]);
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    expect([...new Set(steps.map(step => step.chapter))]).toEqual(WELCOME_CHAPTERS.map((_, i) => i));
  });

  it("按角色展示交付和验收，缺少任务或阻塞时仍有同一条路线", () => {
    const member = buildWelcomeSteps({ ...journey, role: "student" });
    const teacher = buildWelcomeSteps({ ...journey, role: "teacher" });
    expect(member.some(step => ["leader-start", "acceptance", "review"].includes(step.id))).toBe(false);
    expect(member.find(step => step.id === "delivery")?.route).toContain("scope=mine");
    expect(teacher.some(step => ["delivery", "assignments", "leader-start"].includes(step.id))).toBe(false);
    expect(teacher.find(step => step.id === "integration")?.target).toBe('[data-tour="stage-tasks"]');

    const noTasks = buildWelcomeSteps({ ...journey, taskId: null, helpTaskId: null, role: "student" });
    expect(noTasks.map(step => step.id)).toEqual(member.map(step => step.id));
    expect(noTasks.find(step => step.id === "help")?.route).toBe("/collaboration?project=demo-project#help");
    expect(noTasks.find(step => step.id === "delivery")?.target).toBe('[data-tour="execution-console"]');
  });

  it("优先选择演示小组中的可用项目，旧团队只作为可访问的同名示例", () => {
    const legacy = { id: "full", name: "敏捷开发平台", teamId: "team", teamName: "汪汪队", role: "admin" as const, taskTotal: 42 };
    const demo = { ...legacy, id: "demo", teamName: SHOWCASE_TEAM, taskTotal: 20 };
    expect(findShowcaseProject([legacy, demo])?.id).toBe("demo");
    expect(findShowcaseProject([legacy, { ...demo, status: "archived" }])?.id).toBe("full");
    expect(findShowcaseProject([{ ...legacy, id: "empty", taskTotal: 0 }, legacy])?.id).toBe("full");
    expect(findShowcaseProject([{ ...legacy, teamName: "其他团队" }])).toBeNull();
  });
});
