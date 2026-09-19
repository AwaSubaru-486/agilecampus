import { describe, it, expect } from "vitest";
import {
  ACTION_KINDS,
  DEFAULT_QUEUE_LIMIT,
  KIND_ACTION,
  KIND_LABEL,
  KIND_PRIORITY,
  buildActionQueue,
  kindsForRole,
  type ActionKind,
  type RawAction,
} from "@/lib/action-queue";

const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);
const at = (mins: number) => new Date(T0 + mins * 60_000);

function action(over: Partial<RawAction> = {}): RawAction {
  return {
    kind: "assignment_response",
    taskId: "t1",
    blockerId: null,
    title: "写接口",
    projectId: "p1",
    projectName: "赤壁演习",
    context: null,
    dueDate: null,
    at: at(0),
    ...over,
  };
}

describe("行动队列 —— 排序", () => {
  it("按急迫程度排：待回应 > 待验收 > 请搭手 > 被退回 > 逾期 > 快到期", () => {
    const raw: RawAction[] = [
      action({ kind: "due_soon", taskId: "a" }),
      action({ kind: "overdue", taskId: "b" }),
      action({ kind: "blocker_invite", taskId: null, blockerId: "x" }),
      action({ kind: "review", taskId: "c" }),
      action({ kind: "rejected_work", taskId: "d" }),
      action({ kind: "assignment_response", taskId: "e" }),
    ];
    expect(buildActionQueue(raw).items.map((x) => x.kind)).toEqual([
      "assignment_response",
      "review",
      "blocker_invite",
      "rejected_work",
      "overdue",
      "due_soon",
    ]);
  });

  it("同级按发生时刻倒序：刚发生的先看见", () => {
    const raw = [
      action({ taskId: "old", at: at(0) }),
      action({ taskId: "new", at: at(60) }),
      action({ taskId: "mid", at: at(30) }),
    ];
    expect(buildActionQueue(raw).items.map((x) => x.taskId)).toEqual(["new", "mid", "old"]);
  });

  it("再平就按标题定序，保证渲染稳定", () => {
    const raw = [
      action({ taskId: "c", title: "丙" }),
      action({ taskId: "a", title: "甲" }),
      action({ taskId: "b", title: "乙" }),
    ];
    const first = buildActionQueue(raw).items.map((x) => x.taskId);
    const second = buildActionQueue(raw).items.map((x) => x.taskId);
    expect(second).toEqual(first);
    expect(new Set(first)).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("行动队列 —— 去重", () => {
  // 一件被退回的任务往往同时也逾期——那是同一件事的两种说法，只该出现一次
  it("同一任务命中多条原因时只留最急的那条", () => {
    const raw = [
      action({ kind: "overdue", taskId: "t1" }),
      action({ kind: "rejected_work", taskId: "t1" }),
      action({ kind: "assignment_response", taskId: "t1" }),
    ];
    const { items } = buildActionQueue(raw);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("assignment_response");
  });

  // 全局入口上报的阻塞可以不带任务，故求助按 blockerId 去重
  it("求助按 blockerId 去重", () => {
    const raw = [
      action({ kind: "blocker_invite", taskId: null, blockerId: "b1" }),
      action({ kind: "blocker_invite", taskId: null, blockerId: "b1" }),
    ];
    expect(buildActionQueue(raw).items).toHaveLength(1);
  });

  it("不同任务各留一条", () => {
    const raw = [action({ taskId: "t1" }), action({ taskId: "t2" }), action({ taskId: "t3" })];
    expect(buildActionQueue(raw).items).toHaveLength(3);
  });
});

describe("行动队列 —— 截断", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => action({ taskId: `t${i}`, title: `任务${i}` }));

  it("默认最多 8 条，并报出被截掉的数", () => {
    const { items, omitted } = buildActionQueue(many(DEFAULT_QUEUE_LIMIT + 5));
    expect(items).toHaveLength(DEFAULT_QUEUE_LIMIT);
    expect(omitted).toBe(5);
  });

  it("showAll 时全给，omitted 归零", () => {
    const { items, omitted } = buildActionQueue(many(20), { showAll: true });
    expect(items).toHaveLength(20);
    expect(omitted).toBe(0);
  });

  it("不足上限时不截断", () => {
    const { items, omitted } = buildActionQueue(many(3));
    expect(items).toHaveLength(3);
    expect(omitted).toBe(0);
  });

  it("空输入返回空，不报错", () => {
    expect(buildActionQueue([])).toEqual({ items: [], omitted: 0 });
  });
});

describe("每种行动都说得出人话", () => {
  it("六类都有中文名与主动作", () => {
    for (const k of ACTION_KINDS) {
      expect(KIND_LABEL[k]).toBeTruthy();
      expect(KIND_ACTION[k]).toBeTruthy();
      expect(typeof KIND_PRIORITY[k]).toBe("number");
    }
    expect(ACTION_KINDS).toHaveLength(6);
  });

  // 一屏最多一个高强调动作——一行只给一个主动作，故每类的动作词各不相同
  it("主动作各不相同，不会一行给两个按钮", () => {
    const actions = ACTION_KINDS.map((k) => KIND_ACTION[k]);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("角色能收到哪些行动", () => {
  // 老师只验收，不认领、不提交——他不是干活的人
  it("老师只收验收与搭手邀请", () => {
    expect(kindsForRole("teacher")).toEqual(["review", "blocker_invite"]);
  });

  it("学生与组长收全部六类", () => {
    expect(kindsForRole("student")).toHaveLength(6);
    expect(kindsForRole("admin")).toHaveLength(6);
  });

  it("老师收不到的类，优先级表里也都存在", () => {
    for (const k of kindsForRole("teacher")) {
      expect(KIND_PRIORITY[k as ActionKind]).toBeDefined();
    }
  });
});
