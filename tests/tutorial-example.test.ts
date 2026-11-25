import { describe, it, expect } from "vitest";
import { buildWelcomeSteps, WELCOME_CHAPTERS, WELCOME_VERSION, welcomeMinutes } from "@/lib/tutorials/example-flow";
import { findShowcaseProject, SHOWCASE_TEAM } from "@/lib/tutorials/showcase";
import { tutorialReopenStep } from "@/lib/tutorials/route";

const journey = { version: WELCOME_VERSION, teamId: "demo-team", projectId: "demo-project", taskId: "blocked-task", helpTaskId: "blocked-task", role: "admin" } as const;

describe("敏捷开发平台项目导览", () => {
  it("三个角色保留 10 月 12 日导览的主干与顺序", () => {
    const original = {
      admin: "directory roles leader-start assignments board task-list select delivery stages timeline stage timeline-node timeline-detail timeline-close member-view teacher-view review integration leader-view management ai records activity finish",
      student: "directory roles board task-list select delivery stages timeline stage timeline-node timeline-detail timeline-close ai finish",
      teacher: "directory roles stages timeline stage timeline-node timeline-detail timeline-close review integration records activity finish",
    };
    for (const role of ["admin", "student", "teacher"] as const) {
      const spine = original[role].split(" ");
      const steps = buildWelcomeSteps({ ...journey, role });
      expect(steps.map(step => step.id).filter(id => spine.includes(id))).toEqual(spine);
    }
  });

  it("在原路线中接入办公室、求助、实际交付和复盘", () => {
    const steps = buildWelcomeSteps(journey);
    expect(steps[0]).toMatchObject({ route: "/tutorials", target: '[data-tour="tutorial-showcase"]' });
    expect(steps.find(step => step.id === "board")).toMatchObject({ route: "/projects/demo-project", target: '[data-tour="project-office"]' });
    expect(steps.find(step => step.id === "roles")?.route).toBe("/teams/demo-team/members");
    expect(steps.find(step => step.id === "help")?.route).toBe("/collaboration?project=demo-project&task=blocked-task#task-blocked-task");
    expect(steps.find(step => step.id === "delivery")).toMatchObject({
      route: "/projects/demo-project?space=work&scope=all",
      action: "explore",
    });
    expect(steps.find(step => step.id === "select")).toMatchObject({
      route: "/projects/demo-project?space=work&scope=all",
      preferredTarget: '[data-tour="console-task"][data-tour-task-key="blocked-task"]',
    });
    expect(steps.at(-1)?.route).toBe("/tutorials");
    expect(steps.filter(step => step.action === "click").map(step => step.id)).toEqual(["board-open", "board-close", "select", "stage", "timeline-node", "timeline-close"]);
    expect(steps.filter(step => step.action === "result").map(step => step.id)).toEqual([
      "leader-start", "member-view", "teacher-view", "leader-view", "retrospective-generate", "retrospective-member",
    ]);
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    expect([...new Set(steps.map(step => step.chapter))]).toEqual(WELCOME_CHAPTERS.map((_, i) => i));
  });

  it("按角色展示交付和验收，缺少任务或阻塞时仍有同一条路线", () => {
    const member = buildWelcomeSteps({ ...journey, role: "student" });
    const teacher = buildWelcomeSteps({ ...journey, role: "teacher" });
    expect(member.some(step => step.id === "leader-start")).toBe(false);
    expect(member.find(step => step.id === "delivery")?.route).toContain("scope=mine");
    expect(member.find(step => step.id === "member-feedback")?.route).toContain("scope=mine");
    expect(member.some(step => ["review", "integration", "records", "activity"].includes(step.id))).toBe(false);
    expect(teacher.some(step => step.id === "leader-start")).toBe(false);
    expect(teacher.find(step => step.id === "stages")?.target).toBe('[data-tour="stage-progress"]');
    expect(teacher.some(step => ["board", "select", "member-view", "teacher-view", "ai"].includes(step.id))).toBe(false);
    expect(teacher.find(step => step.id === "integration")?.target).toBe('[data-tour="stage-tasks"]');
    expect(teacher.find(step => step.id === "review")?.route).toContain("scope=completed");

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
      expect(reviews.map(step => step.id)).toEqual(["acceptance"]);
      expect(reviews.every(step => step.browseAcceptance && step.route === `/projects/demo-project?space=work&scope=${queue}&task=${taskId}`)).toBe(true);
    }
    expect(buildWelcomeSteps(journey).find(step => step.id === "acceptance")?.route).toBe("/projects/demo-project?space=work&scope=review&panel=list");
  });

  it("老师复核使用已验收样例，之后查看同页的阶段集成再回到组长", () => {
    const steps = buildWelcomeSteps({ ...journey, acceptance: { taskId: "pending", queue: "review" }, reviewedTask: { taskId: "accepted", title: "归档成果" } });
    const index = steps.findIndex(step => step.id === "teacher-view");
    expect(steps.slice(index, index + 5).map(step => step.id)).toEqual(["teacher-view", "review", "integration", "leader-view", "management"]);
    expect(steps[index + 1].route).toBe("/projects/demo-project?space=work&scope=completed&task=accepted");
    expect(steps[index + 2].route).toBe(steps[index + 1].route);
    expect(steps[index + 4].route).toBe("/projects/demo-project?space=home&view=manage");
  });

  it("组长路线控制在约五分钟，各角色沿权限路线收到下一步提示", () => {
    for (const role of ["admin", "student", "teacher"] as const) {
      const steps = buildWelcomeSteps({ ...journey, role, helpTaskTitle: "完善交付材料", taskTitle: "完善交付材料" });
      expect(welcomeMinutes(steps)).toBe(role === "admin" ? 5 : 3);
      expect(steps).toHaveLength({ admin: 33, student: 22, teacher: 17 }[role]);
      expect(steps.every(step => step.guide && step.guide.seconds > 0 && step.guide.handoff.length > 0)).toBe(true);
      expect(steps.filter(step => step.guide?.check).map(step => step.id)).toEqual(role === "teacher" ? [] : ["evidence-plan"]);
      expect(steps.find(step => step.id === "help")?.instruction).toContain("完善交付材料");
      if (role !== "teacher") {
        expect(steps.find(step => step.id === "select")?.instruction).toContain("完善交付材料");
      }
      expect(steps.find(step => step.id === "retrospective-generate")?.instruction).toContain("生成报告");
      expect(steps.at(-1)?.guide?.handoff).toContain("下一轮");
    }
  });

  it("暂停在弹窗或报告时，继续教程能先重新打开所需内容", () => {
    const steps = buildWelcomeSteps(journey);
    for (const [id, opener] of [
      ["board-close", "board-open"], ["timeline-detail", "timeline-node"], ["timeline-close", "timeline-node"],
      ["evidence-plan", "select"],
      ["retrospective-member", "retrospective-generate"],
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
