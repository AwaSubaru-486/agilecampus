import { describe, it, expect } from "vitest";
import { taskStatusEnum } from "@/db/schema";
import { deriveColumns } from "@/lib/board-columns";
import { today } from "@/lib/today";
import {
  TASK_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  DEFAULT_STATUS,
  emptyByStatus,
  statusLabel,
  isCompleted,
  isInReview,
  isTerminal,
  isActive,
  isInFlight,
  canTransition,
  assertTransition,
  type TaskStatus,
} from "@/lib/task-status";

describe("状态转移", () => {
  const ROLES = ["admin", "teacher", "student"] as const;

  it("四档都承认自己是自己", () => {
    for (const from of TASK_STATUSES)
      for (const role of ROLES) expect(canTransition(from, from, role)).toBe(true);
  });

  // 本项目的核心那条边：学生做完只能交出去，判完成的权力在组长与教师手里。
  // 排除 from === "done"：那在同档判真之前就已返回，属无操作而非转移。
  it("学生推不动任何一个任务到 done", () => {
    for (const from of TASK_STATUSES)
      if (from !== "done") expect(canTransition(from, "done", "student")).toBe(false);
  });

  it("组长与教师可直接判 done", () => {
    for (const from of TASK_STATUSES)
      for (const role of ["admin", "teacher"] as const)
        expect(canTransition(from, "done", role)).toBe(true);
  });

  it("打回与重开都走得通", () => {
    expect(canTransition("review", "doing", "admin")).toBe(true); // 退回修改
    expect(canTransition("done", "doing", "student")).toBe(true); // 重开
  });

  it("待验收只去往 doing 或 done，回不到待办", () => {
    expect(canTransition("review", "todo", "admin")).toBe(false);
  });

  it("学生可从待办直提交验收，但不可直跳完成", () => {
    expect(canTransition("todo", "done", "student")).toBe(false);
    expect(canTransition("todo", "review", "student")).toBe(true);
  });

  it("非法转移的提示是给人看的话", () => {
    expect(() => assertTransition("doing", "done", "student")).toThrow(
      "任务须先提交验收，由组长或教师通过后才能标记完成",
    );
    expect(() => assertTransition("review", "todo", "admin")).toThrow("不能将任务由");
  });

  it("合法转移不抛", () => {
    expect(() => assertTransition("doing", "review", "student")).not.toThrow();
    expect(() => assertTransition("review", "done", "teacher")).not.toThrow();
  });
});

describe("状态单一真相源", () => {
  // 这条是防漂移的闸门：lib/task-status.ts 定义常量，db/schema.ts 由此建 pgEnum。
  // 若有人只改一头，此处即红——否则要等到运行时写库才炸。
  it("TASK_STATUSES 与数据库枚举完全一致", () => {
    expect([...TASK_STATUSES]).toEqual([...taskStatusEnum.enumValues]);
  });

  it("默认状态是合法状态", () => {
    expect(TASK_STATUSES).toContain(DEFAULT_STATUS);
  });

  it("文案与配色覆盖每一个状态，无遗漏", () => {
    for (const s of TASK_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
    expect(Object.keys(STATUS_LABEL)).toHaveLength(TASK_STATUSES.length);
    expect(Object.keys(STATUS_TONE)).toHaveLength(TASK_STATUSES.length);
  });
});

describe("emptyByStatus", () => {
  it("每个状态都有键且初值为 0", () => {
    const buckets = emptyByStatus();
    expect(Object.keys(buckets)).toHaveLength(TASK_STATUSES.length);
    for (const s of TASK_STATUSES) expect(buckets[s]).toBe(0);
  });

  // 加档后总数不会因字面量漏项而少算——这正是 project.ts 曾静默出错之处
  it("键数随枚举走，不写死三项", () => {
    expect(Object.keys(emptyByStatus())).toEqual([...TASK_STATUSES]);
  });
});

describe("statusLabel", () => {
  it("已知状态取中文", () => {
    expect(statusLabel("todo")).toBe(STATUS_LABEL.todo);
  });

  it("未知取值原样返回而非崩溃", () => {
    expect(statusLabel("galaxy")).toBe("galaxy");
  });
});

describe("状态谓词", () => {
  it("isCompleted 只认真已完成", () => {
    expect(isCompleted("done")).toBe(true);
    expect(isCompleted("todo")).toBe(false);
    expect(isCompleted("doing")).toBe(false);
  });

  it("isTerminal 与 isCompleted 同义，isActive 为其反面", () => {
    for (const s of TASK_STATUSES) {
      expect(isTerminal(s)).toBe(isCompleted(s));
      expect(isActive(s)).toBe(!isTerminal(s));
    }
  });

  it("isInReview 只认待验收", () => {
    expect(isInReview("review")).toBe(true);
    expect(isInReview("doing")).toBe(false);
    expect(isInReview("done")).toBe(false);
  });

  // 成员负荷的口径：任务交出待验收后，负责人肩上不该再计它。
  // 此断言把「在办」钉死在收活阶段，若日后误改成把 review 也算进来，此处即红。
  it("isInFlight 只算人还攥在手里的活", () => {
    expect(isInFlight("todo")).toBe(true);
    expect(isInFlight("doing")).toBe(true);
    expect(isInFlight("review")).toBe(false);
    expect(isInFlight("done")).toBe(false);
  });

  // 三个谓词恰好把四档分完：进度、负荷、待验收各管一段，互不重叠也不遗漏。
  // 谁若把它们合并成一个 isClosed，此断言立刻报出重复计数。
  it("三谓词穷尽且互斥地划分四档", () => {
    for (const s of TASK_STATUSES) {
      const hits = [isInFlight(s), isInReview(s), isCompleted(s)].filter(Boolean);
      expect(hits).toHaveLength(1);
    }
  });
});

describe("看板状态列随枚举派生", () => {
  it("列的顺序与取值即 TASK_STATUSES", () => {
    const columns = deriveColumns("status", { members: [], milestones: [] });
    expect(columns.map((c) => c.key)).toEqual([...TASK_STATUSES]);
    expect(columns.every((c) => c.patch.status === c.key)).toBe(true);
  });

  it("每列都能匹配自己那一档，且互斥", () => {
    const columns = deriveColumns("status", { members: [], milestones: [] });
    for (const s of TASK_STATUSES) {
      const base = {
        assigneeId: null,
        priority: "medium",
        milestoneId: null,
        dueDate: null,
        labels: [],
        status: s satisfies TaskStatus,
      };
      const hit = columns.filter((c) => c.matches(base));
      expect(hit).toHaveLength(1);
      expect(hit[0].key).toBe(s);
    }
  });
});

describe("today", () => {
  it("形如 YYYY-MM-DD", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 取本地时区而非 UTC：对使用者而言「今天」是他所在的今天。
  // 旧实现两套取法（本地 sv-SE 与 UTC toISOString）在 UTC+8 每天 06:00 前相差一天。
  it("与服务端本地日期一致", () => {
    const d = new Date();
    const expectLocal = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
    expect(today()).toBe(expectLocal);
  });
});
