import { describe, it, expect } from "vitest";
import { buildWelcomeSteps, WELCOME_CHAPTERS, WELCOME_VERSION, welcomeMinutes } from "@/lib/tutorials/example-flow";
import { findShowcaseProject, SHOWCASE_TEAM } from "@/lib/tutorials/showcase";
import { tutorialReopenStep } from "@/lib/tutorials/route";

const journey = { version: WELCOME_VERSION, teamId: "demo-team", projectId: "demo-project", taskId: "blocked-task", helpTaskId: "blocked-task", role: "admin" } as const;

describe("敏捷开发平台项目导览", () => {
  it("从项目办公室走到对应的求助、交付和复盘，步骤无需写入业务数据", () => {
    const steps = buildWelcomeSteps(journey);
    expect(steps[0]).toMatchObject({ route: "/projects/demo-project", target: '[data-tour="project-office"]' });
    expect(steps.find(step => step.id === "roles")?.route).toBe("/teams/demo-team/members");
    expect(steps.find(step => step.id === "help")?.route).toBe("/collaboration?project=demo-project&task=blocked-task#task-blocked-task");
    expect(steps.find(step => step.id === "delivery")).toMatchObject({
      route: "/projects/demo-project?space=work&scope=all",
      action: "explore",
    });
    expect(steps.find(step => step.id === "choose-task")).toMatchObject({
      route: "/projects/demo-project?space=work&scope=all",
      preferredTarget: '[data-tour="console-task"][data-tour-task-key="blocked-task"]',
    });
    expect(steps.at(-1)?.route).toBe("/projects/demo-project/retrospective");
    expect(steps.filter(step => step.action === "click").map(step => step.id)).toEqual(["office-tasks-open", "office-tasks-close", "stage-jump", "timeline-node", "timeline-read", "choose-task"]);
    expect(steps.filter(step => step.action === "result").map(step => step.id)).toEqual([
      "leader-start", "member-view", "leader-review", "teacher-view", "leader-restore", "retrospective-generate", "retrospective-member",
    ]);
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    expect([...new Set(steps.map(step => step.chapter))]).toEqual(WELCOME_CHAPTERS.map((_, i) => i));
  });

  it("按角色展示交付和验收，缺少任务或阻塞时仍有同一条路线", () => {
    const member = buildWelcomeSteps({ ...journey, role: "student" });
    const teacher = buildWelcomeSteps({ ...journey, role: "teacher" });
    expect(member.some(step => step.id === "leader-start")).toBe(false);
    expect(member.find(step => step.id === "delivery")?.route).toContain("scope=mine");
    expect(member.find(step => step.id === "acceptance")?.route).toContain("scope=mine");
    expect(teacher.some(step => step.id === "leader-start")).toBe(false);
    expect(teacher.find(step => step.id === "stage-progress")?.target).toBe('[data-tour="stage-progress"]');
    expect(teacher.some(step => ["choose-task", "member-view", "teacher-view"].includes(step.id))).toBe(false);
    expect(teacher.find(step => step.id === "stage-integration")?.target).toBe('[data-tour="stage-tasks"]');
    expect(teacher.find(step => step.id === "delivery")?.route).toContain("scope=completed");

    const noTasks = buildWelcomeSteps({ ...journey, taskId: null, helpTaskId: null, role: "student" });
    expect(noTasks.map(step => step.id)).toEqual(member.map(step => step.id));
    expect(noTasks.find(step => step.id === "help")?.route).toBe("/collaboration?project=demo-project#help");
    expect(noTasks.find(step => step.id === "delivery")?.fallbackTarget).toBe('[data-tour="execution-console"]');
    expect(noTasks.find(step => step.id === "timeline-node")?.fallbackTarget).toContain('data-tour-empty="true"');
  });

  it("验收章沿用同一份真实交付，空队列仍可继续", () => {
    for (const [queue, taskId] of [["review", "review-task"], ["completed", "done-task"]] as const) {
      const steps = buildWelcomeSteps({ ...journey, acceptance: { taskId, queue } });
      const reviews = steps.filter(step => step.browseAcceptance);
      expect(reviews.map(step => step.id)).toEqual(["acceptance", "acceptance-evidence", "acceptance-check"]);
      expect(reviews.every(step => step.browseAcceptance && step.route === `/projects/demo-project?space=work&scope=${queue}&task=${taskId}`)).toBe(true);
    }
    expect(buildWelcomeSteps(journey).find(step => step.id === "acceptance")?.route).toBe("/projects/demo-project?space=work&scope=review&panel=list");
  });

  it("老师复核使用已验收样例，之后查看同页的阶段集成再回到组长", () => {
    const steps = buildWelcomeSteps({ ...journey, acceptance: { taskId: "pending", queue: "review" }, reviewedTask: { taskId: "accepted", title: "归档成果" } });
    const index = steps.findIndex(step => step.id === "teacher-view");
    expect(steps.slice(index, index + 4).map(step => step.id)).toEqual(["teacher-view", "teacher-reviewed", "stage-integration", "leader-restore"]);
    expect(steps[index + 1].route).toBe("/projects/demo-project?space=work&scope=completed&task=accepted");
    expect(steps[index + 2].route).toBe(steps[index + 1].route);
    expect(steps[index + 3].route).toBe("/projects/demo-project?space=home&view=manage");
  });

  it("各视角用约五分钟完成同一条协作主线，每步给出接下来的行动", () => {
    for (const role of ["admin", "student", "teacher"] as const) {
      const steps = buildWelcomeSteps({ ...journey, role, helpTaskTitle: "完善交付材料", taskTitle: "完善交付材料" });
      expect(welcomeMinutes(steps)).toBe(role === "admin" ? 6 : 5);
      expect(steps).toHaveLength(role === "admin" ? 33 : 24);
      expect(steps.every(step => step.guide && step.guide.seconds > 0 && step.guide.handoff.length > 0)).toBe(true);
      expect(steps.filter(step => step.guide?.check).map(step => step.id)).toEqual(["help-check", "evidence-plan", "acceptance-check"]);
      expect(steps.find(step => step.id === "help")?.instruction).toContain("完善交付材料");
      if (role !== "teacher") {
        expect(steps.find(step => step.id === "choose-task")?.instruction).toContain("完善交付材料");
      }
      expect(steps.find(step => step.id === "retrospective-generate")?.instruction).toContain("生成报告");
      expect(steps.at(-1)?.guide?.handoff).toContain("下一轮");
    }
  });

  it("暂停在弹窗或报告时，继续教程能先重新打开所需内容", () => {
    const steps = buildWelcomeSteps(journey);
    for (const [id, opener] of [
      ["office-tasks-close", "office-tasks-open"], ["timeline-read", "timeline-node"],
      ["evidence-plan", "choose-task"],
      ["retrospective-overview", "retrospective-generate"], ["retrospective", "retrospective-generate"],
    ]) {
      expect(steps[tutorialReopenStep(steps, steps.findIndex(step => step.id === id))]?.id).toBe(opener);
    }
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
