import { describe, expect, it } from "vitest";
import { tutorialDemoPlan } from "@/lib/tutorials/demo-plan";
import { validateDraftPlan } from "@/lib/draft-planning";
import type { TaskTreePayload } from "@/lib/task-tree";

const task = (key: string) => ({ key, parentKey: null, title: key, description: "", assigneeId: null, priority: "medium" as const, doneCriteria: ["checked"] });
describe("teaching task relationships", () => {
  it("shows parallel starts, a join and a cross-stage successor without claiming AI output", () => {
    const payload: TaskTreePayload = { summary: "demo", stages: [{ title: "first", tasks: [task("signup"), task("checks"), task("verify")] }, { title: "second", tasks: [task("receipt")] }] };
    const plan = tutorialDemoPlan(payload)!;
    expect(plan.source).toBe("manual");
    expect(plan.stages[0].links.map(link => link.afterKeys)).toEqual([[], [], ["signup", "checks"]]);
    expect(plan.stages[1].links[0].afterKeys).toEqual(["verify"]);
    expect(() => validateDraftPlan(payload, plan)).not.toThrow();
  });
  it("supports the existing two-task example and ignores unrelated projects", () => {
    const payload: TaskTreePayload = { summary: "old", stages: [{ title: "first", tasks: [task("signup")] }, { title: "second", tasks: [task("receipt")] }] };
    expect(tutorialDemoPlan(payload)?.stages[1].links[0].afterKeys).toEqual(["signup"]);
    payload.stages[0].tasks[0].key = "ordinary";
    expect(tutorialDemoPlan(payload)).toBeNull();
  });
});
