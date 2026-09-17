import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  blockers,
  milestoneHighlights,
  milestones,
  tasks,
  users,
  type HighlightKind,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { isCompleted, isInFlight } from "./task-status";
import { today } from "./today";

// 里程碑的自动记录。
//
// 原本里程碑是人工设的检查点，谁填、何时填全凭自觉，于是要么空着、
// 要么沦为事后补记。这里把它改成**功勋墙**：达成时自己标记，
// 并把当时值得记住的事冻结下来——人一格都不用填。
//
// 全部走确定性规则，不碰 AI：规则可复现、可单测、不会漏也不会编。

const DAY_MS = 86_400_000;

export type MilestoneProgress = {
  id: string;
  title: string;
  targetDate: string | null;
  status: "open" | "done";
  achievedAt: Date | null;
  /** 达成那一刻冻结的实况，人直接读 */
  autoSummary: string | null;
  total: number;
  done: number;
  highlights: Highlight[];
  /** 还差哪些。主视图据此显示「还差 2 项」并列出是谁在做 */
  remaining: {
    id: string;
    title: string;
    status: string;
    assigneeName: string | null;
    assigneeKind: "human" | "agent" | null;
    overdue: boolean;
  }[];
};

export type Highlight = {
  id: string;
  kind: HighlightKind;
  note: string;
  actorName: string | null;
  actorKind: "human" | "agent" | null;
  taskTitle: string | null;
  createdAt: Date;
};

// 高光类型的措辞。放这里供界面复用，避免两处各写一套。
export const HIGHLIGHT_LABEL: Record<HighlightKind, string> = {
  delivered_by_agent: "AI 交付",
  reworked: "返工过",
  unblocked: "卡过又解决",
  late_done: "逾期完成",
  first_delivery: "首件交付",
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeKind: "human" | "agent" | null;
  dueDate: string | null;
  committedAt: Date | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  estimatedHours: number | null;
  rejectCount: number;
};

/**
 * 从一件已完成的任务里提取值得记的一笔。纯函数，逐条可测。
 *
 * 返回空数组是常态——大多数任务是顺顺当当做完的，
 * 那本就不该在功勋墙上占一格。只记艰难的、或由 AI 交付的。
 */
export function extractHighlights(
  task: TaskRow,
  ctx: {
    /** 该任务是否卡过且已解决 */
    wasBlockedAndResolved: boolean;
    /** 是不是本项目第一件交付 */
    isFirstDelivery: boolean;
  },
): { kind: HighlightKind; note: string }[] {
  if (!isCompleted(task.status)) return [];
  const out: { kind: HighlightKind; note: string }[] = [];
  const who = task.assigneeName ?? "某人";

  if (task.assigneeKind === "agent") {
    const note = task.submittedAt
      ? `由 ${who}（AI）交付`
      : `由 ${who}（AI）交付`;
    out.push({ kind: "delivered_by_agent", note });
  }

  if (task.rejectCount > 0) {
    out.push({ kind: "reworked", note: `${who}的交付被退回 ${task.rejectCount} 次后通过` });
  }

  // 这里本该有一条「实际耗时超出预估」。删了——挂钟时间不是投入时长：
  // 任务在那儿放着七天，不等于干了七天。贡献记录里已把「实际投入」
  // 列为量不到的维度，此处若拿它当规则，就是自相矛盾。
  // 「做得费劲」这件事，返工、卡住、逾期三条已经覆盖。

  if (ctx.wasBlockedAndResolved) {
    out.push({ kind: "unblocked", note: `${who}卡住后求助，问题解决才做成` });
  }

  // 逾期完成：以交付那一刻对照截止日，不用「今天」——
  // 否则一件按时完成的任务会随着时间流逝变成「逾期」
  const doneAt = task.reviewedAt ?? task.submittedAt;
  if (task.dueDate && doneAt) {
    const due = Date.parse(`${task.dueDate}T00:00:00Z`);
    const doneDay = Date.parse(`${doneAt.toISOString().slice(0, 10)}T00:00:00Z`);
    const late = Math.floor((doneDay - due) / DAY_MS);
    if (late > 0) out.push({ kind: "late_done", note: `逾期 ${late} 天后完成` });
  }

  if (ctx.isFirstDelivery) {
    out.push({ kind: "first_delivery", note: `${who}交出这个项目的第一件成果` });
  }

  return out;
}

// 拉全一个项目的里程碑进度，并把该记的高光补上。
//
// 在读取时顺手同步，与 sweepOfflineAgents 同一路数：状态由数据推出，
// 不额外维护一份会过期的副本。唯一索引保证重复调用不会记重。
export async function listMilestoneProgress(
  actorId: string,
  projectId: string,
): Promise<MilestoneProgress[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [ms, taskRows, blockedTaskIds] = await Promise.all([
    db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(milestones.targetDate),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        milestoneId: tasks.milestoneId,
        assigneeId: tasks.assigneeId,
        assigneeName: users.name,
        assigneeKind: users.kind,
        dueDate: tasks.dueDate,
        committedAt: tasks.committedAt,
        submittedAt: tasks.submittedAt,
        reviewedAt: tasks.reviewedAt,
        estimatedHours: tasks.estimatedHours,
        rejectCount: tasks.rejectCount,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.projectId, projectId)),
    // 卡过、且已解决的任务
    db
      .select({ taskId: blockers.taskId })
      .from(blockers)
      .where(and(eq(blockers.projectId, projectId), eq(blockers.status, "resolved"))),
  ]);

  const unblocked = new Set(blockedTaskIds.map((b) => b.taskId).filter(Boolean));
  const day = today();

  // 本项目第一件交付（按验收时刻最早的那件）
  const delivered = taskRows.filter((t) => isCompleted(t.status));
  const firstDeliveryId =
    delivered
      .slice()
      .sort((a, b) => (a.reviewedAt?.getTime() ?? 0) - (b.reviewedAt?.getTime() ?? 0))[0]?.id ?? null;

  // 逐里程碑提取高光并落库；唯一索引拦重复
  for (const m of ms) {
    const own = taskRows.filter((t) => t.milestoneId === m.id);
    for (const t of own) {
      const found = extractHighlights(t as TaskRow, {
        wasBlockedAndResolved: unblocked.has(t.id),
        isFirstDelivery: t.id === firstDeliveryId,
      });
      for (const h of found) {
        await db
          .insert(milestoneHighlights)
          .values({
            milestoneId: m.id,
            taskId: t.id,
            kind: h.kind,
            note: h.note,
            actorId: t.assigneeId,
          })
          .onConflictDoNothing();
      }
    }
  }

  const highlightRows =
    ms.length > 0
      ? await db
          .select({
            id: milestoneHighlights.id,
            milestoneId: milestoneHighlights.milestoneId,
            kind: milestoneHighlights.kind,
            note: milestoneHighlights.note,
            actorName: users.name,
            actorKind: users.kind,
            taskTitle: tasks.title,
            createdAt: milestoneHighlights.createdAt,
          })
          .from(milestoneHighlights)
          .leftJoin(users, eq(milestoneHighlights.actorId, users.id))
          .leftJoin(tasks, eq(milestoneHighlights.taskId, tasks.id))
          .where(inArray(milestoneHighlights.milestoneId, ms.map((m) => m.id)))
          .orderBy(desc(milestoneHighlights.createdAt))
      : [];

  return ms.map((m) => {
    const own = taskRows.filter((t) => t.milestoneId === m.id);
    const done = own.filter((t) => isCompleted(t.status)).length;
    const remaining = own
      .filter((t) => !isCompleted(t.status))
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeName: t.assigneeName,
        assigneeKind: t.assigneeKind,
        overdue: isInFlight(t.status) && t.dueDate !== null && t.dueDate < day,
      }));

    return {
      id: m.id,
      title: m.title,
      targetDate: m.targetDate,
      status: m.status,
      achievedAt: m.achievedAt,
      autoSummary: m.autoSummary,
      total: own.length,
      done,
      highlights: highlightRows
        .filter((h) => h.milestoneId === m.id)
        .map((h) => ({
          id: h.id,
          kind: h.kind,
          note: h.note,
          actorName: h.actorName,
          actorKind: h.actorKind,
          taskTitle: h.taskTitle,
          createdAt: h.createdAt,
        })),
      remaining,
    };
  });
}

// 达成即自动标记。
//
// 「达成」= 这个里程碑下的任务全部完成，且至少有一件。
// 一个没有任务的里程碑永远不达成——否则新建的空里程碑会立刻自己点亮。
export async function syncMilestoneAchievement(actorId: string, projectId: string): Promise<number> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [ms, taskRows, highlights] = await Promise.all([
    db.select().from(milestones).where(eq(milestones.projectId, projectId)),
    db
      .select({ id: tasks.id, status: tasks.status, milestoneId: tasks.milestoneId })
      .from(tasks)
      .where(eq(tasks.projectId, projectId)),
    db
      .select({
        milestoneId: milestoneHighlights.milestoneId,
        note: milestoneHighlights.note,
      })
      .from(milestoneHighlights)
      .orderBy(desc(milestoneHighlights.createdAt)),
  ]);

  let changed = 0;
  for (const m of ms) {
    if (m.status === "done") continue;
    const own = taskRows.filter((t) => t.milestoneId === m.id);
    if (own.length === 0) continue;
    if (!own.every((t) => isCompleted(t.status))) continue;

    // 达成摘要冻结当下：干成了几件，其中哪几件值得记住
    const notes = highlights.filter((h) => h.milestoneId === m.id).map((h) => h.note);
    const summary =
      `共完成 ${own.length} 项` +
      (notes.length > 0 ? `；其中值得记住的：${notes.slice(0, 3).join("；")}` : "");

    await db
      .update(milestones)
      .set({
        status: "done",
        achievedAt: sql`now()`,
        autoSummary: summary,
      })
      .where(and(eq(milestones.id, m.id), eq(milestones.status, "open")));
    changed++;
  }
  return changed;
}

// 人工关闭/重开仍允许——自动判定是默认，不是牢笼。
// 但要留一句为什么，供复盘看。
export async function setMilestoneStatus(
  actorId: string,
  milestoneId: string,
  status: "open" | "done",
  note?: string,
) {
  const [m] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!m) throw new AppError("里程碑不存在");
  const access = await getProjectForUser(actorId, m.projectId);
  if (!access || access.role !== "admin") throw new ForbiddenError();

  const [updated] = await db
    .update(milestones)
    .set({
      status,
      achievedAt: status === "done" ? sql`now()` : null,
      autoSummary: note?.trim() ? `人工标记：${note.trim()}` : m.autoSummary,
    })
    .where(eq(milestones.id, milestoneId))
    .returning();
  return updated;
}
