import { describe, it, expect } from "vitest";
import {
  applyExampleStep,
  EMPTY_EXAMPLE,
  EXAMPLE_FIELDS,
  EXAMPLE_FLOW,
} from "@/lib/tutorials/example-flow";
describe("教学示例状态", () => {
  it("拒绝缺失输入、非法阶段以及越过准备", () => {
    expect(() => applyExampleStep(EMPTY_EXAMPLE, 0, {}, "now")).toThrow(
      "团队名称",
    );
    expect(() =>
      applyExampleStep(
        EMPTY_EXAMPLE,
        0,
        { team: 23 } as unknown as Record<string, string>,
        "now",
      ),
    ).toThrow("团队名称");
    expect(() => applyExampleStep(EMPTY_EXAMPLE, 14, {}, "now")).toThrow(
      "无效",
    );
    expect(() => applyExampleStep(EMPTY_EXAMPLE, 5, {}, "now")).toThrow(
      "上一项",
    );
  });
  it("全流程累积成果，重复提交幂等且忽略未允许字段", () => {
    let state = EMPTY_EXAMPLE;
    for (let phase = 0; phase < EXAMPLE_FLOW.length; phase++) {
      state = applyExampleStep(
        state,
        phase,
        {
          ...Object.fromEntries(
            EXAMPLE_FIELDS[phase].map((field) => [
              field.key,
              field.placeholder,
            ]),
          ),
          role: "admin",
          actorId: "someone",
        },
        "now",
      );
      expect(applyExampleStep(state, phase, {}, "later")).toBe(state);
    }
    expect(state.phase).toBe(14);
    expect(state.events).toHaveLength(14);
    expect(state.values.evidence).toBeTruthy();
    expect(state.values.improvement).toBeTruthy();
    expect(state.values.role).toBeUndefined();
    expect(state.values.actorId).toBeUndefined();
    expect(EMPTY_EXAMPLE.phase).toBe(0);
  });
});
