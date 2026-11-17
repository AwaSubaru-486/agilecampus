import { describe, expect, it } from "vitest";
import { tutorialReopenStep, tutorialStepRoute } from "@/lib/tutorials/route";
import { buildTutorialCourses } from "@/lib/tutorials/catalog";

describe("教程步骤中的任务上下文", () => {
  it("恢复弹窗步骤时回到本课程的打开入口，React 会话表单仍在当前步骤恢复", () => {
    const courses = buildTutorialCourses({ id: "project", name: "Demo", teamId: "team", role: "teacher" });
    for (const [courseId, lost, opener] of [
      ["task-tree", "detail", "node"], ["review", "evaluation-close", "evaluation"],
      ["risks", "help-close", "help"], ["ai", "chat-title", "chat-title"],
      ["ai", "chat-close", "chat-close"],
    ]) {
      const { steps } = courses.find(course => course.id === courseId)!;
      expect(steps[tutorialReopenStep(steps, steps.findIndex(step => step.id === lost))]?.id).toBe(opener);
    }
  });
  it("保留刚点选的任务，让窄屏下一步仍能解释详情", () => {
    expect(
      tutorialStepRoute(
        "/projects/a?space=work",
        "/projects/a?space=work&task=chosen&panel=task",
      ),
    ).toBe("/projects/a?space=work&task=chosen");
  });
  it("需要重新选择任务的步骤仍强制打开列表", () => {
    expect(
      tutorialStepRoute(
        "/projects/a?space=work&panel=list",
        "/projects/a?space=work&task=chosen",
      ),
    ).toBe("/projects/a?space=work&panel=list");
  });
  it("不将其他项目的任务或旧看板视图带到下一步", () => {
    expect(
      tutorialStepRoute(
        "/projects/b?space=work",
        "/projects/a?space=work&task=chosen",
      ),
    ).toBe("/projects/b?space=work");
    expect(
      tutorialStepRoute(
        "/projects/a?space=work",
        "/projects/a?space=work&view=board&task=chosen",
      ),
    ).toBe("/projects/a?space=work&task=chosen");
  });
});
