import { describe, expect, it } from "vitest";
import { emptyDraftPlan, followingTasks, removePlannedTask, taskLevels, validateDraftPlan } from "@/lib/draft-planning";
import type { TaskTreePayload } from "@/lib/task-tree";

function scene() {
  const payload: TaskTreePayload = { summary: "规划一个项目", stages: [{ title: "第一阶段", tasks: ["a", "b", "c", "d"].map(key => ({
    key, parentKey: null, title: key, description: "", priority: "medium", assigneeId: null, doneCriteria: ["可以验收"],
  })) }] };
  const plan = emptyDraftPlan(payload);
  plan.stages[0].links = [
    { key: "a", afterKeys: [], reason: "起点" }, { key: "b", afterKeys: ["a"], reason: "需要 a" },
    { key: "c", afterKeys: ["a"], reason: "与 b 并行" }, { key: "d", afterKeys: ["b", "c"], reason: "汇合" },
  ];
  return { payload, plan };
}
describe("草案科技树关系", () => {
  it("平行分支同层，会合任务等两个前置", () => {
    const { payload, plan } = scene(); validateDraftPlan(payload, plan);
    expect(Object.fromEntries(taskLevels(plan.stages[0]))).toEqual({ a: 0, b: 1, c: 1, d: 2 });
  });
  it("拖到自己的后续会形成循环，必须拒绝", () => {
    const { payload, plan } = scene(); plan.stages[0].links[0].afterKeys = ["d"];
    expect(() => validateDraftPlan(payload, plan)).toThrow("循环");
  });
  it("删除并保留后续，会合保留另一分支并接回前置，不删验收资料", () => {
    const { payload, plan } = scene(); const result = removePlannedTask(payload, plan, 0, "b", true);
    expect(result.payload.stages[0].tasks.map(task => task.key)).toEqual(["a", "c", "d"]);
    expect(result.plan.stages[0].links.find(link => link.key === "d")?.afterKeys).toEqual(["a", "c"]);
    expect(result.payload.stages[0].tasks[2].doneCriteria).toEqual(["可以验收"]);
    expect(payload.stages[0].tasks).toHaveLength(4);
  });
  it("删除后续包含共享会合节点，保留旁边未依赖此任务的分支", () => {
    const { payload, plan } = scene();
    expect([...followingTasks(payload.stages[0].tasks, plan.stages[0], "b")]).toEqual(["d"]);
    const result = removePlannedTask(payload, plan, 0, "b", false);
    expect(result.payload.stages[0].tasks.map(task => task.key)).toEqual(["a", "c"]);
  });
  it("保留分组子任务时继承祖先分组，不改成顺序依赖", () => {
    const { payload } = scene(); payload.stages[0].tasks[1].parentKey = "a"; payload.stages[0].tasks[2].parentKey = "b";
    const result = removePlannedTask(payload, emptyDraftPlan(payload), 0, "b", true);
    expect(result.payload.stages[0].tasks.find(task => task.key === "c")?.parentKey).toBe("a");
    expect(result.plan.stages[0].links.find(link => link.key === "c")?.afterKeys).toEqual([]);
  });
  it("不允许将分组当成执行前置，也不允许遗漏任务", () => {
    const { payload, plan } = scene(); payload.stages[0].tasks[1].parentKey = "a";
    expect(() => validateDraftPlan(payload, plan)).toThrow("分组");
    plan.stages[0].links.pop(); expect(() => validateDraftPlan(payload, plan)).toThrow("每个任务");
  });
  it("删除空阶段会重新编号，但不能删除最后一个阶段的全部任务", () => {
    const { payload, plan } = scene(); expect(() => removePlannedTask(payload, plan, 0, "a", false)).toThrow("至少");
    payload.stages.push({ title: "第二阶段", tasks: [{ ...payload.stages[0].tasks[0], key: "next" }] });
    plan.stages.push({ stageIndex: 1, links: [{ key: "next", afterKeys: [], reason: "下一轮" }] });
    const result = removePlannedTask(payload, plan, 0, "a", false);
    expect(result.plan.stages[0].stageIndex).toBe(0); expect(result.payload.stages[0].title).toBe("第二阶段");
  });
});
