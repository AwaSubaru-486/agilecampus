import type { TeamRole } from "@/db/schema";

// 行动队列：跨项目告诉我「现在该我做什么」。
//
// 这是「今日」页与顶部徽章的唯一真相源。两处必须同源——
// 徽章说有 3 件事等你，点进去就得看到 3 件；各算各的迟早对不上。
// （验收报告 P1-3 指出的正是这个：徽章只数待回应，今日页却还列了待验收。）
//
// 排序、去重全在纯函数里做，可逐条单测；取数在壳里，见 loadActionQueue。

export const ACTION_KINDS = [
  "assignment_response", // 派给我、我还没回话
  "approval_review", // AI 写操作待人确认
  "review", // 我交的或别人交的，等我验收
  "blocker_invite", // 有人点名请我搭手
  "rejected_work", // 我的交付被退回
  "overdue", // 我负责的、已过期
  "due_soon", // 我负责的、三天内到期
] as const;
// 决策确认是独立于任务流的行动。它不放进旧的六类通配列表，避免
// 破坏按角色筛选任务行动的旧契约；今日页仍会把它作为一等行动展示。
export type ActionKind = (typeof ACTION_KINDS)[number] | "decision_review";

/** 越靠前越急。同一件事命中多条原因时，取最靠前的那条。 */
export const KIND_PRIORITY: Record<ActionKind, number> = {
  assignment_response: 0,
  approval_review: 1,
  decision_review: 2,
  review: 3,
  blocker_invite: 4,
  rejected_work: 5,
  overdue: 6,
  due_soon: 7,
};

export const KIND_LABEL: Record<ActionKind, string> = {
  assignment_response: "待回应",
  approval_review: "AI 待确认",
  decision_review: "待确认方案",
  review: "待验收",
  blocker_invite: "请你搭手",
  rejected_work: "被退回",
  overdue: "已逾期",
  due_soon: "快到期",
};

/** 每种行动的主动作。一屏最多一个高强调动作，故一行只给一个。 */
export const KIND_ACTION: Record<ActionKind, string> = {
  assignment_response: "接住 / 接不住",
  approval_review: "确认 / 驳回",
  decision_review: "选方案 / 写理由",
  review: "通过 / 退回",
  blocker_invite: "去看看",
  rejected_work: "改完重交",
  overdue: "更新进展",
  due_soon: "看一眼",
};

export type RawAction = {
  kind: ActionKind;
  /** 任务、求助、决策三类行动各自指向一个目标；三者可空但不同时为空 */
  taskId: string | null;
  blockerId: string | null;
  /** 决策类行动指向决策；与任务、求助一样只会命中一个目标 */
  decisionId?: string | null;
  approvalId?: string | null;
  title: string;
  projectId: string;
  projectName: string;
  /** 补充一句：谁派的、卡在哪、为什么退回 */
  context: string | null;
  dueDate: string | null;
  /** 排序用的时刻：越近发生越靠前 */
  at: Date;
};

export const DEFAULT_QUEUE_LIMIT = 8;

/**
 * 排序 + 去重。纯函数。
 *
 * 去重按「同一件事」而非「同一任务」——一件任务可能同时是
 * 「我被退回的」和「已逾期的」，那是同一件事的两种说法，只该出现一次。
 * 求助类没有 taskId（全局入口上报的阻塞可以不带任务），故按 blockerId 去重。
 */
export function buildActionQueue(
  raw: RawAction[],
  opts?: { limit?: number; showAll?: boolean },
): { items: RawAction[]; omitted: number } {
  // 同一件事取最急的那条原因
  const byThing = new Map<string, RawAction>();
  for (const a of raw) {
    const key = a.taskId
      ? `t:${a.taskId}`
      : a.blockerId
        ? `b:${a.blockerId}`
        : a.decisionId
          ? `d:${a.decisionId}`
          : a.approvalId
            ? `a:${a.approvalId}`
          : `x:${a.title}`;
    const existing = byThing.get(key);
    if (!existing || KIND_PRIORITY[a.kind] < KIND_PRIORITY[existing.kind]) {
      byThing.set(key, a);
    }
  }

  const sorted = [...byThing.values()].sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      // 同优先级按发生时刻倒序：刚发生的事先看见
      b.at.getTime() - a.at.getTime() ||
      // 再平就按标题定序，保证渲染稳定
      a.title.localeCompare(b.title, "zh"),
  );

  if (opts?.showAll) return { items: sorted, omitted: 0 };
  const limit = opts?.limit ?? DEFAULT_QUEUE_LIMIT;
  return { items: sorted.slice(0, limit), omitted: Math.max(0, sorted.length - limit) };
}

/** 某角色能收到哪些行动。老师只验收，不参与认领与提交。 */
export function kindsForRole(role: TeamRole): ActionKind[] {
  if (role === "teacher") return ["review", "blocker_invite"];
  return [...ACTION_KINDS];
}
