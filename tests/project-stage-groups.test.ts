import { describe, expect, it } from "vitest";
import { groupTasksByStage } from "@/lib/project-stage-groups";
describe("按阶段组织个人任务", () => {
  it("保持阶段顺序和空阶段，未分阶段的任务不丢失", () => {
    const rows = [{ id: "future", stageId: "s2" }, { id: "none", stageId: null }, { id: "unknown", stageId: "removed" }];
    const groups = groupTasksByStage([{ id: "s1", title: "需求" }, { id: "s2", title: "实现" }], rows);
    expect(groups.map(group => group.label)).toEqual(["阶段 1", "阶段 2", "未分阶段"]);
    expect(groups[0].tasks).toEqual([]);
    expect(groups[1].tasks.map(task => task.id)).toEqual(["future"]);
    expect(groups[2].tasks.map(task => task.id)).toEqual(["none", "unknown"]);
  });
});
