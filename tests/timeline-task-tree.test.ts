import { describe, expect, it } from "vitest";
import { mapTimelinePlan, mapWholeTimelinePlan } from "@/lib/timeline-task-tree";
import { emptyDraftPlan } from "@/lib/draft-planning";
import type { TaskTreePayload } from "@/lib/task-tree";

const payload: TaskTreePayload = { summary: "项目", stages: [{ title: "开发", tasks: ["确认需求", "前端", "后端", "联调"].map((title, index) => ({ key: `task-${index}`, title, parentKey: null, description: "", assigneeId: null, priority: "medium", doneCriteria: [] })) }] };
const original = { ...payload.stages[0], tasks: payload.stages[0].tasks.map((task, index) => ({ ...task, key: `draft-${index}` })) };
const links = original.tasks.map((task, index) => ({ key: task.key, afterKeys: index === 0 ? [] : index === 3 ? ["draft-1", "draft-2"] : ["draft-0"], reason: "编排" }));

describe("时间线草案关系映射", () => {
  it("发布后将草案 key 映射成任务 ID，保留并行和汇合", () => {
    const plan = mapTimelinePlan(payload, original, links);
    expect(plan?.stages[0].links[3].afterKeys).toEqual(["task-1", "task-2"]);
    expect(plan?.stages[0].links[1].afterKeys).toEqual(["task-0"]);
  });
  it("删除、改名或同名歧义不猜连接，不将数组顺序当依赖", () => {
    for (const tasks of [payload.stages[0].tasks.slice(1), payload.stages[0].tasks.map(task => ({ ...task, title: "重复名称" }))]) expect(mapTimelinePlan({ ...payload, stages: [{ ...payload.stages[0], tasks }] }, original, links)).toBeNull();
    expect(emptyDraftPlan(payload).stages[0].links.every(link => !link.afterKeys.length)).toBe(true);
  });
  it("本地旧关系包含循环或缺失标记时拒绝恢复", () => {
    expect(mapTimelinePlan(payload, original, links.slice(1))).toBeNull();
    expect(mapTimelinePlan(payload, original, links.map((link, index) => index === 0 ? { ...link, afterKeys: ["draft-3"] } : link))).toBeNull();
  });
  it("发布后保留跨阶段编排，不因真实任务 ID 改变而丢失连接", () => {
    const source = { summary: "两轮交付", stages: [original, { title: "交付", tasks: [{ ...original.tasks[0], key: "release", title: "发布" }] }] };
    const actual = { ...source, stages: [payload.stages[0], { ...source.stages[1], tasks: [{ ...source.stages[1].tasks[0], key: "published-release" }] }] };
    const plan = emptyDraftPlan(source); plan.stages[0].links = links; plan.stages[1].links[0].afterKeys = ["draft-3"];
    expect(mapWholeTimelinePlan(actual, source, plan)?.stages[1].links[0].afterKeys).toEqual(["task-3"]);
    actual.stages[1].tasks[0].title = "改名";
    expect(mapWholeTimelinePlan(actual, source, plan)).toBeNull();
  });
});
