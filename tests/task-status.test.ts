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
  isTerminal,
  isActive,
  isInFlight,
  type TaskStatus,
} from "@/lib/task-status";

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

  // 成员负荷的口径：任务交出待验收后，负责人肩上不该再计它。
  // 此断言把「在办」钉死在收活阶段，日后引入验收档时若误改成含 review，此处即红。
  it("isInFlight 只算人还攥在手里的活", () => {
    expect(isInFlight("todo")).toBe(true);
    expect(isInFlight("doing")).toBe(true);
    expect(isInFlight("done")).toBe(false);
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
