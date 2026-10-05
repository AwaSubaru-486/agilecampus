import type { ActivityType } from "@/db/schema";
import { BLOCKER_REASON_LABEL, type BlockerReason } from "./blocker-labels";

// 接力链：一件工作怎么在人和 AI 之间流转。
//
// 看板回答「这件事在哪个状态」，接力链回答「它现在停在谁手上、为什么停」。
// 后者才是人机混合团队真正的问题——活不会消失，它只是卡在某个人
// （或某个 agent）那里，而没人知道。
//
// 全部由既有活动流推出，不额外记一份账。

export type RelayActorKind = "human" | "agent" | null;

export type RelayStep = {
  actorName: string | null;
  actorKind: RelayActorKind;
  /** 人话动词：提出 / 接住 / 交付 / 卡住…… */
  action: string;
  at: Date;
  /** 交付与退回时带上说明 */
  note?: string | null;
};

export type RelayChain = {
  taskId: string;
  taskTitle: string;
  status: string;
  steps: RelayStep[];
  /** 现在停在谁手上。null 表示没人接 */
  holder: string | null;
  holderKind: RelayActorKind;
  /** 若当前正卡着，一句话说清卡在哪 */
  stuck: string | null;
  lastAt: Date;
};

export type RelayEvent = {
  taskId: string | null;
  type: ActivityType;
  actorId: string | null;
  actorName: string | null;
  actorKind: RelayActorKind;
  payload: unknown;
  createdAt: Date;
};

export type RelayTask = { id: string; title: string; status: string; assigneeId: string | null };

// 哪些事件算接力上的一棒。其余（贴标签、改截止日、建里程碑）不入链——
// 链要短到一眼能读完，什么都塞进去就等于什么都没说。
const RELAY_ACTIONS: Partial<Record<ActivityType, string>> = {
  task_created: "提出",
  task_assigned: "指派",
  task_claimed: "接住",
  task_declined: "接不住",
  task_submitted: "交付",
  task_accepted: "验收通过",
  task_rejected: "退回",
  blocker_raised: "卡住",
  blocker_resolved: "求助已解",
};

// 从 payload 里挑一句人话。
//
// ⚠️ 绝不取 `reason`——那是数据库枚举（tech / unclear / dependency），
// 界面上会出现「卡住了：dependency」这种句子。
// 求助的原因要经 blocker-labels 映射；此处若映射不了，就直接不取，
// 让调用方回退到一句通用话。
const NOTE_KEYS = ["note", "completionNote", "commitmentNote", "helpNeeded", "detail"] as const;

function pickNote(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const k of NOTE_KEYS) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * 从活动流拼出接力链。纯函数，不碰库，故可逐条单测。
 *
 * 每个任务一条链，按最后一棒的时间倒序——最近动过的排最前，
 * 因为那才是「现在正在发生什么」。
 */
export function buildRelayChains(
  events: RelayEvent[],
  tasks: RelayTask[],
  opts?: { limit?: number; onlyActive?: boolean },
): RelayChain[] {
  const byTask = new Map<string, RelayEvent[]>();
  for (const e of events) {
    if (!e.taskId) continue;
    if (!RELAY_ACTIONS[e.type]) continue;
    const list = byTask.get(e.taskId) ?? [];
    list.push(e);
    byTask.set(e.taskId, list);
  }

  const chains: RelayChain[] = [];
  for (const t of tasks) {
    const own = byTask.get(t.id);
    if (!own || own.length === 0) continue;
    if (opts?.onlyActive && t.status === "done") continue;

    // 时间正序：链条要从「提出」读到最后
    const sorted = own.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const steps: RelayStep[] = sorted.map((e) => ({
      actorName: e.actorName,
      actorKind: e.actorKind,
      action: RELAY_ACTIONS[e.type]!,
      at: e.createdAt,
      note: pickNote(e.payload),
    }));

    // 当前停在谁手上：最后一条「接住」的操作者，被退回或接不住则无人
    const last = sorted[sorted.length - 1];
    const lastClaim = sorted.filter((e) => e.type === "task_claimed").pop();
    const holderEvent =
      last.type === "task_declined" || last.type === "task_rejected" ? null : lastClaim ?? null;

    // 卡着：最近一条 blocker_raised 晚于最近的 blocker_resolved
    const lastRaise = sorted.filter((e) => e.type === "blocker_raised").pop();
    const lastResolve = sorted.filter((e) => e.type === "blocker_resolved").pop();
    const stuck =
      lastRaise && (!lastResolve || lastResolve.createdAt < lastRaise.createdAt)
        ? pickNote(lastRaise.payload) ?? "有人求助了"
        : null;

    chains.push({
      taskId: t.id,
      taskTitle: t.title,
      status: t.status,
      steps,
      holder: holderEvent?.actorName ?? null,
      holderKind: holderEvent?.actorKind ?? null,
      stuck,
      lastAt: sorted[sorted.length - 1].createdAt,
    });
  }

  chains.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  return opts?.limit ? chains.slice(0, opts.limit) : chains;
}

// 一句话概括这条链现在到哪一步了。主视图上每条链只占一行摘要。
export function relayHeadline(chain: RelayChain): string {
  if (chain.stuck) {
    const reason = BLOCKER_REASON_LABEL[chain.stuck as BlockerReason] ?? chain.stuck;
    return `卡住了：${reason}`;
  }
  switch (chain.status) {
    case "review":
      return "等人验收";
    case "done":
      return "已完成";
    case "todo":
      return chain.holder ? "已接住，待开工" : "还没人接";
    default:
      return chain.holder ? `${chain.holder}在做` : "没人接";
  }
}
