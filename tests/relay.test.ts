import { describe, it, expect } from "vitest";
import { buildRelayChains, relayHeadline, type RelayEvent } from "@/lib/relay";

const T0 = Date.UTC(2026, 8, 10, 9, 0, 0);
const at = (mins: number) => new Date(T0 + mins * 60_000);

function ev(
  type: RelayEvent["type"],
  actorName: string,
  mins: number,
  over: Partial<RelayEvent> = {},
): RelayEvent {
  return {
    taskId: "t1",
    type,
    actorId: `u-${actorName}`,
    actorName,
    actorKind: actorName.includes("小") ? "agent" : "human",
    payload: null,
    createdAt: at(mins),
    ...over,
  };
}

const TASK = { id: "t1", title: "实现问答接口", status: "doing", assigneeId: "u-周瑜" };

describe("接力链", () => {
  it("把一件事从提出到交付串成一条链", () => {
    const chains = buildRelayChains(
      [
        ev("task_created", "孙权", 0),
        ev("task_claimed", "小码", 10),
        ev("task_submitted", "小码", 60),
        ev("task_accepted", "诸葛瑾", 90),
      ],
      [{ ...TASK, status: "done" }],
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].steps.map((s) => s.action)).toEqual(["提出", "接住", "交付", "验收通过"]);
    // 人与 AI 混在一条线上，靠 actorKind 区分
    expect(chains[0].steps[1].actorKind).toBe("agent");
    expect(chains[0].steps[1].actorName).toBe("小码");
  });

  // 链要短到一眼读完，什么都塞进去等于什么都没说
  it("贴标签、改截止日这类不入链", () => {
    const chains = buildRelayChains(
      [ev("task_created", "孙权", 0), ev("task_labeled", "孙权", 5), ev("task_updated", "孙权", 6)],
      [TASK],
    );
    expect(chains[0].steps.map((s) => s.action)).toEqual(["提出"]);
  });

  it("按时间正序，不是倒序", () => {
    const chains = buildRelayChains(
      [ev("task_submitted", "小码", 60), ev("task_created", "孙权", 0), ev("task_claimed", "小码", 10)],
      [TASK],
    );
    expect(chains[0].steps.map((s) => s.action)).toEqual(["提出", "接住", "交付"]);
  });

  it("现在停在谁手上＝最后接住的那个人", () => {
    const chains = buildRelayChains(
      [ev("task_created", "孙权", 0), ev("task_claimed", "小码", 10)],
      [TASK],
    );
    expect(chains[0].holder).toBe("小码");
    expect(chains[0].holderKind).toBe("agent");
  });

  it("被退回过就不算停在谁手上——活回到了待办", () => {
    const chains = buildRelayChains(
      [
        ev("task_created", "孙权", 0),
        ev("task_claimed", "小码", 10),
        ev("task_submitted", "小码", 60),
        ev("task_rejected", "诸葛瑾", 70),
      ],
      [{ ...TASK, status: "doing" }],
    );
    expect(chains[0].holder).toBeNull();
  });

  it("接不住也不停在谁手上", () => {
    const chains = buildRelayChains(
      [ev("task_created", "孙权", 0), ev("task_claimed", "周瑜", 5), ev("task_declined", "周瑜", 20)],
      [{ ...TASK, status: "todo", assigneeId: null }],
    );
    expect(chains[0].holder).toBeNull();
    expect(chains[0].steps.map((s) => s.action)).toContain("接不住");
  });

  it("卡住时把原因带出来，解决后不再算卡", () => {
    const raised = ev("blocker_raised", "小文", 30, { payload: { helpNeeded: "缺实验数据" } });
    const still = buildRelayChains([ev("task_created", "孙权", 0), raised], [TASK]);
    expect(still[0].stuck).toBe("缺实验数据");

    const resolved = buildRelayChains(
      [ev("task_created", "孙权", 0), raised, ev("blocker_resolved", "周瑜", 50)],
      [TASK],
    );
    expect(resolved[0].stuck).toBeNull();
  });

  it("先解决后又卡住，算卡着", () => {
    const chains = buildRelayChains(
      [
        ev("task_created", "孙权", 0),
        ev("blocker_raised", "小文", 10, { payload: { helpNeeded: "第一次" } }),
        ev("blocker_resolved", "周瑜", 20),
        ev("blocker_raised", "小文", 30, { payload: { helpNeeded: "又卡了" } }),
      ],
      [TASK],
    );
    expect(chains[0].stuck).toBe("又卡了");
  });

  it("没有任务 id 的事件（如建里程碑）不入任何链", () => {
    const chains = buildRelayChains([ev("task_created", "孙权", 0, { taskId: null })], [TASK]);
    expect(chains).toHaveLength(0);
  });

  it("最近动过的排最前", () => {
    const chains = buildRelayChains(
      [
        ev("task_created", "孙权", 0, { taskId: "t1" }),
        ev("task_created", "孙权", 100, { taskId: "t2" }),
      ],
      [TASK, { id: "t2", title: "另一件", status: "todo", assigneeId: null }],
    );
    expect(chains[0].taskId).toBe("t2");
  });

  it("只看在办的可以过滤掉已完成的", () => {
    const events = [ev("task_created", "孙权", 0), ev("task_accepted", "诸葛瑾", 90)];
    expect(buildRelayChains(events, [{ ...TASK, status: "done" }])).toHaveLength(1);
    expect(buildRelayChains(events, [{ ...TASK, status: "done" }], { onlyActive: true })).toHaveLength(0);
  });

  it("交付与退回带出说明", () => {
    const chains = buildRelayChains(
      [
        ev("task_rejected", "诸葛瑾", 10, { payload: { note: "没写测试" } }),
        ev("task_submitted", "小码", 5, { payload: { completionNote: "接口都通了" } }),
      ],
      [TASK],
    );
    const notes = chains[0].steps.map((s) => s.note);
    expect(notes).toContain("接口都通了");
    expect(notes).toContain("没写测试");
  });
});

describe("一句话概括", () => {
  const base = { taskId: "t1", taskTitle: "x", steps: [], lastAt: at(0), holder: null, holderKind: null };

  it("卡着时先说卡", () => {
    expect(relayHeadline({ ...base, status: "doing", stuck: "缺数据" })).toContain("缺数据");
  });

  it("待验收说等人验收", () => {
    expect(relayHeadline({ ...base, status: "review", stuck: null })).toBe("等人验收");
  });

  it("没人接要明说", () => {
    expect(relayHeadline({ ...base, status: "todo", stuck: null, holder: null })).toBe("还没人接");
  });

  it("在做就说谁在做", () => {
    expect(
      relayHeadline({ ...base, status: "doing", stuck: null, holder: "小码", holderKind: "agent" }),
    ).toContain("小码");
  });
});
