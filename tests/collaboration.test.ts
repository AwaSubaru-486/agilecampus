import { describe, it, expect } from "vitest";
import {
  CAPACITY,
  OVERLOAD_IN_FLIGHT,
  rankHelpers,
  scoreOf,
  type HelperCandidate,
} from "@/lib/collaboration";

// 纯函数，不碰库。信号只有本项目真有的三样：在办数、同里程碑完成数、救过的同类阻塞。
function cand(over: Partial<HelperCandidate> = {}): HelperCandidate {
  return {
    userId: "u1",
    name: "甲",
    load: 0,
    proximityMilestone: 0,
    proximityLabel: 0,
    helpCount: 0,
    ...over,
  };
}

describe("rankHelpers —— 排序", () => {
  it("同等熟悉度下，手上活少的人排前面", () => {
    const out = rankHelpers([
      cand({ userId: "busy", name: "忙", load: 4, proximityMilestone: 2 }),
      cand({ userId: "free", name: "闲", load: 0, proximityMilestone: 2 }),
    ]);
    expect(out[0].userId).toBe("free");
  });

  it("同等空闲下，做过相关任务的人排前面", () => {
    const out = rankHelpers([
      cand({ userId: "stranger", name: "生", proximityMilestone: 0 }),
      cand({ userId: "familiar", name: "熟", proximityMilestone: 3 }),
    ]);
    expect(out[0].userId).toBe("familiar");
  });

  it("曾救过同类阻塞是强信号，但权重低于熟悉度", () => {
    const helper = scoreOf(cand({ helpCount: 2 }));
    const familiar = scoreOf(cand({ proximityMilestone: 3 }));
    expect(helper).toBeGreaterThan(0);
    expect(familiar).toBeGreaterThan(helper);
  });

  it("在办数达容量上限则可用度归零，但不倒扣", () => {
    expect(scoreOf(cand({ load: CAPACITY }))).toBeCloseTo(0, 5);
    expect(scoreOf(cand({ load: CAPACITY + 5 }))).toBeCloseTo(0, 5);
  });

  it("默认只给三个候选", () => {
    const many = Array.from({ length: 6 }, (_, i) => cand({ userId: `u${i}`, name: `人${i}` }));
    expect(rankHelpers(many)).toHaveLength(3);
    expect(rankHelpers(many, { limit: 5 })).toHaveLength(5);
  });

  it("空候选池返回空数组，不报错", () => {
    expect(rankHelpers([])).toEqual([]);
  });

  // 平局必须没有歧义：同一条求助两次打开若推荐不同的人，用户就不知道该信哪个。
  // 断言「稳定」而非某个具体顺序——姓名比较走 zh collation（拼音序），
  // 而拼音序依赖 Node 是否带完整 ICU，钉死具体次序会让测试随环境而红。
  it("分数与在办数都相同时，次序稳定不摇摆", () => {
    const pool = [
      cand({ userId: "c", name: "丙" }),
      cand({ userId: "a", name: "甲" }),
      cand({ userId: "b", name: "乙" }),
    ];
    const first = rankHelpers(pool).map((x) => x.userId);
    const second = rankHelpers(pool).map((x) => x.userId);
    expect(second).toEqual(first);
    expect(new Set(first)).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("rankHelpers —— 理由要能读", () => {
  it("每个信号都译成人话", () => {
    const [top] = rankHelpers([
      cand({ name: "甲", proximityMilestone: 2, proximityLabel: 1, helpCount: 1, load: 1 }),
    ]);
    expect(top.reasons).toContain("在同一里程碑下完成过 2 个任务");
    expect(top.reasons).toContain("做过 1 个同类标签的任务");
    expect(top.reasons).toContain("曾解决过 1 次同类阻塞");
    expect(top.reasons).toContain("目前只有 1 个在办任务");
  });

  it("过载者如实说明他可能抽不开身，而不是假装看不见", () => {
    const [top] = rankHelpers([
      cand({ proximityMilestone: 3, load: OVERLOAD_IN_FLIGHT }),
    ]);
    expect(top.reasons.some((r) => r.includes("可能抽不开身"))).toBe(true);
  });

  it("完全不忙的人得到正面说法", () => {
    const [top] = rankHelpers([cand({ proximityMilestone: 3, load: 0 })]);
    expect(top.reasons).toContain("目前手上没有在办任务");
  });
});

describe("rankHelpers —— 冷启动", () => {
  // 课程小组恰恰第一天就会卡住：无任何历史信号时若返回空，
  // 推荐列表会在最需要它的时刻缺席
  it("全无历史信号时不返回空，退化为按空闲度排序并标记降级", () => {
    const out = rankHelpers([
      cand({ userId: "busy", name: "忙", load: 3 }),
      cand({ userId: "free", name: "闲", load: 0 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].userId).toBe("free");
    expect(out[0].degraded).toBe(true);
  });

  it("降级时不说自己不了解的事", () => {
    const [top] = rankHelpers([cand({ load: 0 })]);
    expect(top.reasons).toEqual(["目前手上没有在办任务"]);
  });

  it("只要有一人有任何历史信号，就不算冷启动", () => {
    const out = rankHelpers([
      cand({ userId: "a", name: "甲", helpCount: 1 }),
      cand({ userId: "b", name: "乙", load: 0 }),
    ]);
    expect(out.every((x) => !x.degraded)).toBe(true);
  });
});
