import { describe, expect, it, vi } from "vitest";
import { findTutorialTarget } from "@/lib/tutorials/target";
import { buildTutorialCourses } from "@/lib/tutorials/catalog";

function element(shown = true, expanded = "false") {
  return { getBoundingClientRect: () => ({ width: shown ? 280 : 0, height: shown ? 48 : 0 }), getAttribute: () => expanded, click: vi.fn() } as unknown as HTMLElement;
}
function root(rows: HTMLElement[], toggle: HTMLElement | null = null, empty: HTMLElement | null = null) {
  return { querySelectorAll: () => rows, querySelector: (selector: string) => selector.includes("completed-toggle") ? toggle : empty } as unknown as Pick<Document, "querySelectorAll" | "querySelector">;
}

describe("任务教程入口恢复", () => {
  it("真实可见任务优先，不将正常任务操作降级为空列表学习", () => {
    const task = element();
    expect(findTutorialTarget(root([element(false), task], null, element()), '[data-tour="console-task"]')).toEqual({ element: task, emptyTaskList: false });
  });
  it("仅有折叠的已完成任务时展开分组，随后定位实际任务", () => {
    const toggle = element();
    expect(findTutorialTarget(root([], toggle), '[data-tour="console-task"]').element).toBeNull();
    expect(toggle.click).toHaveBeenCalledOnce();
    const task = element();
    expect(findTutorialTarget(root([task], toggle), '[data-tour="console-task"]').element).toBe(task);
    expect(toggle.click).toHaveBeenCalledOnce();
  });
  it("空任务列表可以先学习流程，隐藏的列表不能当成定位成功", () => {
    const list = element();
    expect(findTutorialTarget(root([], null, list), '[data-tour="console-task"]')).toEqual({ element: list, emptyTaskList: true });
    expect(findTutorialTarget(root([], null, element(false)), '[data-tour="console-task"]').element).toBeNull();
  });
  it("不为其他教程目标误用任务列表空态", () => {
    expect(findTutorialTarget(root([], null, element()), '[data-tour="teacher-evaluation"]')).toEqual({ element: null, emptyTaskList: false });
  });
  it("第十一步强制打开列表面板，避免窄屏已选任务隐藏列表", () => {
    const project = { id: "project", teamId: "team", role: "admin" as const, name: "实训" };
    const step = buildTutorialCourses(project)[0].steps[10];
    expect(step.id).toBe("execution:console");
    expect(step.route).toBe("/projects/project?space=work&panel=list");
  });
});
