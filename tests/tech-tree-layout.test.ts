import { describe, expect, it } from "vitest";
import { emptyDraftPlan, removePlannedTask, validateDraftPlan } from "@/lib/draft-planning";
import { directPlanningLinks, layoutTechTree } from "@/lib/tech-tree-layout";
import type { TaskTreePayload } from "@/lib/task-tree";

function scene() {
  const task = (key: string) => ({ key, title: key, parentKey: null, description: "", assigneeId: null, priority: "medium" as const, doneCriteria: ["结果可检查"] });
  const payload: TaskTreePayload = { summary: "需求、实现、交付", stages: [{ title: "需求", tasks: [task("a")] }, { title: "实现", tasks: [task("b"), task("c")] }, { title: "交付", tasks: [task("d")] }] };
  const plan = emptyDraftPlan(payload);
  plan.stages[1].links.forEach(link => { link.afterKeys = ["a"]; });
  plan.stages[2].links[0].afterKeys = ["b", "c"];
  return { payload, plan };
}

describe("连续项目科技树", () => {
  it("只隐藏已经经过中间任务表达的重复连线，保留分叉与汇合", () => {
    const { plan } = scene();
    const full = { stageIndex: 0, links: plan.stages.flatMap(stage => stage.links) };
    full.links[3].afterKeys.push("a");
    expect(directPlanningLinks(full).links[3].afterKeys).toEqual(["b", "c"]);
    expect(full.links[3].afterKeys).toEqual(["b", "c", "a"]);
    expect(directPlanningLinks(full).links[1].afterKeys).toEqual(["a"]);
  });
  it("跨阶段分叉与汇合连续排列，阶段边界不穿过节点", () => {
    const { payload, plan } = scene();
    validateDraftPlan(payload, plan);
    const result = layoutTechTree(payload.stages.flatMap(stage => stage.tasks), { stageIndex: 0, links: plan.stages.flatMap(stage => stage.links) }, payload.stages.map(stage => ({ title: stage.title, keys: stage.tasks.map(task => task.key) })));
    const a = result.positions.get("a")!, b = result.positions.get("b")!, c = result.positions.get("c")!, d = result.positions.get("d")!;
    expect(a.x).toBeLessThan(b.x); expect(b.x).toBe(c.x); expect(b.y).not.toBe(c.y); expect(d.x).toBeGreaterThan(c.x);
    expect(result.bands).toHaveLength(3);
    expect(result.bands[1].left).toBeGreaterThan(a.x + 252);
    expect(result.bands[1].left).toBeLessThan(b.x);
    expect(result.bands[2].left).toBeGreaterThan(c.x + 252);
  });
  it("保留真正并行的独立起点，不按数组顺序添加依赖", () => {
    const { payload } = scene(); const plan = emptyDraftPlan(payload);
    const result = layoutTechTree(payload.stages.flatMap(stage => stage.tasks), { stageIndex: 0, links: plan.stages.flatMap(stage => stage.links) }, payload.stages.map(stage => ({ title: stage.title, keys: stage.tasks.map(task => task.key) })));
    expect(result.positions.get("b")!.x).toBe(result.positions.get("c")!.x);
    expect(plan.stages.flatMap(stage => stage.links).every(link => !link.afterKeys.length)).toBe(true);
  });
  it("拒绝依赖未来阶段、跨阶段重复 key 和分组依赖", () => {
    const { payload, plan } = scene(); plan.stages[0].links[0].afterKeys = ["d"];
    expect(() => validateDraftPlan(payload, plan)).toThrow("后面的阶段");
    plan.stages[0].links[0].afterKeys = [];
    payload.stages[1].tasks[1].parentKey = "b";
    expect(() => validateDraftPlan(payload, plan)).toThrow("分组");
    payload.stages[1].tasks[1].key = "a";
    expect(() => validateDraftPlan(payload, plan)).toThrow("重复");
  });
  it("删除跨阶段节点时保留后续并接回前置，或一起删后续并重排阶段", () => {
    const { payload, plan } = scene();
    const kept = removePlannedTask(payload, plan, 1, "b", true);
    expect(kept.plan.stages[2].links[0].afterKeys).toEqual(["a", "c"]);
    const removed = removePlannedTask(payload, plan, 1, "b", false);
    expect(removed.payload.stages.map(stage => stage.title)).toEqual(["需求", "实现"]);
    expect(removed.payload.stages[1].tasks.map(task => task.key)).toEqual(["c"]);
    expect(() => removePlannedTask(payload, plan, 0, "a", false)).toThrow("至少");
  });
});
