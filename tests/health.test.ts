import { describe, it, expect } from "vitest";
import {
  OVERLOAD_IN_FLIGHT,
  REVIEW_LATENCY_DAYS,
  STALE_DAYS,
  UNASSIGNED_GRACE_DAYS,
  evaluateProjectHealth,
  type HealthBlockerInput,
  type HealthInput,
  type HealthTaskInput,
} from "@/lib/health";

const DAY = 86_400_000;
const TODAY = "2026-09-17";
const NOW = Date.parse("2026-09-17T12:00:00Z");
const ADMIN = { id: "admin", name: "孙权" };
const MEMBERS = [ADMIN, { id: "zhang", name: "张昭" }, { id: "zhou", name: "周瑜" }];

function task(over: Partial<HealthTaskInput> = {}): HealthTaskInput {
  return {
    id: "t1",
    title: "撰写调研问卷",
    status: "doing",
    assigneeId: "zhang",
    assigneeName: "张昭",
    dueDate: null,
    updatedAtMs: NOW,
    submittedAtMs: null,
    createdAtMs: NOW - 10 * DAY,
    ...over,
  };
}

function blocker(over: Partial<HealthBlockerInput> = {}): HealthBlockerInput {
  return {
    id: "b1",
    taskTitle: null,
    raisedByName: "周瑜",
    reason: "tech",
    ageHours: 5,
    ...over,
  };
}

function run(over: Partial<HealthInput> = {}) {
  return evaluateProjectHealth({
    tasks: [],
    blockers: [],
    members: MEMBERS,
    today: TODAY,
    nowMs: NOW,
    adminId: ADMIN.id,
    adminName: ADMIN.name,
    ...over,
  });
}

const signals = (input: Partial<HealthInput>) => run(input).map((i) => i.signal);

describe("健康度 —— 不伪造问题", () => {
  // 一份干净的项目就该报平安。若无风险也凑出几条「建议关注」，这张面板三天就会被无视
  it("一切正常时返回空数组", () => {
    expect(run({ tasks: [task()] })).toEqual([]);
  });

  it("无任务无阻塞时也返回空数组", () => {
    expect(run()).toEqual([]);
  });
});

describe("健康度 —— 逾期", () => {
  it("检出逾期并说明超期天数", () => {
    const [issue] = run({ tasks: [task({ dueDate: "2026-09-15" })] });
    expect(issue.signal).toBe("overdue");
    expect(issue.whyRed).toContain("超期 2 天");
    expect(issue.ownerId).toBe("zhang");
  });

  it("超期三日以上升为高危", () => {
    const [issue] = run({ tasks: [task({ dueDate: "2026-09-10" })] });
    expect(issue.severity).toBe("high");
  });

  it("没设截止日的永不逾期", () => {
    expect(signals({ tasks: [task({ dueDate: null })] })).not.toContain("overdue");
  });

  it("已完成的不算逾期", () => {
    expect(signals({ tasks: [task({ dueDate: "2026-09-01", status: "done" })] })).not.toContain(
      "overdue",
    );
  });

  // 待验收还没过验收，就是没交付完
  it("待验收的仍算逾期", () => {
    expect(signals({ tasks: [task({ dueDate: "2026-09-15", status: "review" })] })).toContain(
      "overdue",
    );
  });

  it("无人负责的逾期任务归组长定夺", () => {
    const [issue] = run({
      tasks: [task({ dueDate: "2026-09-15", assigneeId: null, assigneeName: null })],
    });
    expect(issue.ownerId).toBe(ADMIN.id);
    expect(issue.action).toContain("指定负责人");
  });
});

describe("健康度 —— 无人负责", () => {
  // 刚排上的活还没派出去是常态，立刻报警只会让人对警报脱敏
  it("宽限期内不报", () => {
    const t = task({
      assigneeId: null,
      assigneeName: null,
      createdAtMs: NOW - (UNASSIGNED_GRACE_DAYS - 1) * DAY,
    });
    expect(signals({ tasks: [t] })).not.toContain("unassigned");
  });

  it("超过宽限期即报，且归组长", () => {
    const t = task({
      assigneeId: null,
      assigneeName: null,
      createdAtMs: NOW - (UNASSIGNED_GRACE_DAYS + 1) * DAY,
    });
    const [issue] = run({ tasks: [t] });
    expect(issue.signal).toBe("unassigned");
    expect(issue.ownerId).toBe(ADMIN.id);
  });

  it("已完成的不算无人负责", () => {
    const t = task({
      status: "done",
      assigneeId: null,
      assigneeName: null,
      createdAtMs: NOW - 30 * DAY,
    });
    expect(signals({ tasks: [t] })).not.toContain("unassigned");
  });
});

describe("健康度 —— 长期未更新", () => {
  it("满七天未动即报", () => {
    const t = task({ updatedAtMs: NOW - STALE_DAYS * DAY });
    const [issue] = run({ tasks: [t] });
    expect(issue.signal).toBe("stale");
    expect(issue.ownerId).toBe("zhang");
  });

  it("差一天不报", () => {
    expect(signals({ tasks: [task({ updatedAtMs: NOW - (STALE_DAYS - 1) * DAY })] })).not.toContain(
      "stale",
    );
  });
});

describe("健康度 —— 成员负荷", () => {
  const many = (n: number, over: Partial<HealthTaskInput> = {}) =>
    Array.from({ length: n }, (_, i) =>
      task({ id: `t${i}`, assigneeId: "zhang", assigneeName: "张昭", ...over }),
    );

  it("达到上限即报，且归组长调配", () => {
    const [issue] = run({ tasks: many(OVERLOAD_IN_FLIGHT) });
    expect(issue.signal).toBe("overload");
    // 告诉当事人「你太忙了」没有用，调配是组长的活
    expect(issue.ownerId).toBe(ADMIN.id);
    expect(issue.whyRed).toContain("张昭");
  });

  it("差一项不报", () => {
    expect(signals({ tasks: many(OVERLOAD_IN_FLIGHT - 1) })).not.toContain("overload");
  });

  // 任务交出去待验收，人已经交出手了，不该再计在他头上
  it("待验收的不计入负荷", () => {
    expect(signals({ tasks: many(OVERLOAD_IN_FLIGHT, { status: "review" }) })).not.toContain(
      "overload",
    );
  });
});

describe("健康度 —— 阻塞", () => {
  it("有未解决求助即报，且恒为高危", () => {
    const [issue] = run({ blockers: [blocker()] });
    expect(issue.signal).toBe("blocked");
    expect(issue.severity).toBe("high");
  });

  // 健康度与协作推荐的交汇点：「谁来做」取自推荐，不是查表填名字
  it("有人选时，谁来做取自协作推荐", () => {
    const [issue] = run({
      blockers: [blocker({ id: "b1" })],
      blockerHelpers: { b1: { userId: "zhou", name: "周瑜" } },
    });
    expect(issue.ownerId).toBe("zhou");
    expect(issue.ownerName).toBe("周瑜");
    expect(issue.action).toContain("周瑜");
  });

  it("无人可推时不说假话，只给通用建议", () => {
    const [issue] = run({ blockers: [blocker()] });
    expect(issue.ownerId).toBeNull();
    expect(issue.action).toContain("能搭手就搭手");
  });
});

describe("健康度 —— 验收延迟", () => {
  const pending = (days: number) =>
    task({ status: "review", submittedAtMs: NOW - days * DAY, updatedAtMs: NOW });

  it("交付等待超期即报，且催的是验收人", () => {
    const [issue] = run({ tasks: [pending(REVIEW_LATENCY_DAYS)] });
    expect(issue.signal).toBe("review_latency");
    // 球在验收人脚下，故归 admin——这正是待验收任务不再催负责人的理由
    expect(issue.ownerId).toBe(ADMIN.id);
    expect(issue.whyRed).toContain("交付已等验收");
  });

  it("刚交上来的不报", () => {
    expect(signals({ tasks: [pending(0)] })).not.toContain("review_latency");
  });

  it("没有提交时刻的待验收不报（数据不全时不猜）", () => {
    expect(signals({ tasks: [task({ status: "review", submittedAtMs: null })] })).not.toContain(
      "review_latency",
    );
  });
});

describe("健康度 —— 次序", () => {
  it("高危排在中等之前", () => {
    const out = run({
      tasks: [task({ id: "a", assigneeId: null, assigneeName: null, createdAtMs: NOW - 30 * DAY })],
      blockers: [blocker()],
    });
    expect(out[0].severity).toBe("high");
    expect(out[0].signal).toBe("blocked");
  });

  // 同一份数据每次渲染顺序必须一致，否则界面会莫名跳动
  it("同样输入两次得到同样次序", () => {
    const input = {
      tasks: [
        task({ id: "a", dueDate: "2026-09-15" }),
        task({ id: "b", updatedAtMs: NOW - 20 * DAY }),
      ],
      blockers: [blocker()],
    };
    expect(run(input).map((i) => i.signal)).toEqual(run(input).map((i) => i.signal));
  });

  it("多条风险并存时各报各的，不合并成一条", () => {
    const out = run({
      tasks: [task({ id: "a", dueDate: "2026-09-15" })],
      blockers: [blocker()],
    });
    expect(out.map((i) => i.signal)).toContain("overdue");
    expect(out.map((i) => i.signal)).toContain("blocked");
  });
});

describe("健康度 —— 每条都要答三问", () => {
  it("任何一条风险都得说清为什么红、该做什么、谁来做", () => {
    const out = run({
      tasks: [
        task({ id: "a", dueDate: "2026-09-10" }),
        task({ id: "b", assigneeId: null, assigneeName: null, createdAtMs: NOW - 30 * DAY }),
        task({ id: "c", updatedAtMs: NOW - 30 * DAY }),
        task({ id: "d", status: "review", submittedAtMs: NOW - 10 * DAY }),
      ],
      blockers: [blocker()],
    });
    expect(out.length).toBeGreaterThanOrEqual(5);
    for (const issue of out) {
      expect(issue.whyRed.length).toBeGreaterThan(0);
      expect(issue.action.length).toBeGreaterThan(0);
      expect(issue.evidence.length).toBeGreaterThan(0);
    }
  });
});
