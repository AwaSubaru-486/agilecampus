import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, taskLabels, tasks, teamMembers, users, type BlockerReason } from "@/db/schema";
import { getProjectForUser } from "./project";
import { isInFlight } from "./task-status";

// 「谁能帮上忙」的推荐。
//
// 按可解释性赋权，而非按预测力：推荐结果要给用户看理由，
// 说不出所以然的信号不如不用。三个信号都是本项目真有的数据，
// 没有一个是拍脑袋想出来的特征。
//
// 刻意不做「阻塞原因 ↔ 任务分类」的匹配：任务表根本没有分类列，
// 唯一能当分类用的只有标签，而标签匹配已经并进 proximity 了。
// 用原因去猜「谁擅长技术难题」既没有依据，也没法验。

// 常量集中，便于调参，也便于写进报告时当设计参数讨论。
/** 单成员舒适的在办任务上限。超过则可用度归零。 */
export const CAPACITY = 4;
/** 相关任务做到 3 个即视为满分熟悉度。 */
export const PROX_TARGET = 3;
/** 救过 2 次同类阻塞即视为满分互助度。 */
export const HELP_TARGET = 2;
/** 手上超过此数则视为过载，健康度与推荐两处共用。 */
export const OVERLOAD_IN_FLIGHT = 5;

const W_PROX = 0.45;
const W_AVAIL = 0.35;
const W_HELP = 0.2;

export type HelperCandidate = {
  userId: string;
  name: string;
  /** 当前在办任务数（不含待验收——那已交出手） */
  load: number;
  /** 在阻塞所涉里程碑下已完成的任务数 */
  proximityMilestone: number;
  /** 完成过且与阻塞任务共享标签的任务数 */
  proximityLabel: number;
  /** 曾解决过的、同类原因的阻塞数 */
  helpCount: number;
};

export type HelperSuggestion = {
  userId: string;
  name: string;
  score: number;
  reasons: string[];
  /** 冷启动：无任何历史信号，退化为按空闲度推荐 */
  degraded: boolean;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function availability(c: HelperCandidate): number {
  return clamp01(1 - c.load / CAPACITY);
}

function proximity(c: HelperCandidate): number {
  return Math.min(1, (c.proximityMilestone * 1.0 + c.proximityLabel * 0.5) / PROX_TARGET);
}

function helpfulness(c: HelperCandidate): number {
  return Math.min(1, c.helpCount / HELP_TARGET);
}

function reasonsFor(c: HelperCandidate, degraded: boolean): string[] {
  const out: string[] = [];
  if (degraded) {
    // 冷启动时只说得出「他现在不忙」——不必假装了解别的
    if (c.load === 0) out.push("目前手上没有在办任务");
    else out.push(`目前有 ${c.load} 个在办任务`);
    return out;
  }

  if (c.proximityMilestone > 0) out.push(`在同一里程碑下完成过 ${c.proximityMilestone} 个任务`);
  if (c.proximityLabel > 0) out.push(`做过 ${c.proximityLabel} 个同类标签的任务`);
  if (c.helpCount > 0) out.push(`曾解决过 ${c.helpCount} 次同类阻塞`);
  if (c.load === 0) out.push("目前手上没有在办任务");
  else if (c.load <= 2) out.push(`目前只有 ${c.load} 个在办任务`);
  else if (c.load >= OVERLOAD_IN_FLIGHT) out.push(`手上已有 ${c.load} 个在办任务，可能抽不开身`);
  return out;
}

export function scoreOf(c: HelperCandidate): number {
  return W_PROX * proximity(c) + W_AVAIL * availability(c) + W_HELP * helpfulness(c);
}

/**
 * 给一个阻塞排出「谁可能帮得上」。
 *
 * 冷启动必须显式处理：全零分（新项目、无历史）时退化为按空闲度排序。
 * 课程小组恰恰第一天就会卡住，不处理这条，推荐列表在最有用的时刻是空的。
 *
 * 排序确定性：分数降序 → 在办数升序 → 姓名升序。测试要稳定就得没有平局歧义。
 */
export function rankHelpers(
  candidates: HelperCandidate[],
  opts?: { limit?: number },
): HelperSuggestion[] {
  if (candidates.length === 0) return [];

  const degraded = candidates.every(
    (c) => c.proximityMilestone === 0 && c.proximityLabel === 0 && c.helpCount === 0,
  );

  const scored = candidates.map((c) => ({
    userId: c.userId,
    name: c.name,
    score: degraded ? availability(c) : scoreOf(c),
    reasons: reasonsFor(c, degraded),
    degraded,
    load: c.load,
  }));

  scored.sort(
    (a, b) => b.score - a.score || a.load - b.load || a.name.localeCompare(b.name, "zh"),
  );

  return scored.slice(0, opts?.limit ?? 3).map((s) => ({
    userId: s.userId,
    name: s.name,
    score: s.score,
    reasons: s.reasons,
    degraded: s.degraded,
  }));
}

// ============ 取数壳 ============

/** 阻塞所涉的上下文：任务与里程碑。两者皆可为空（全局入口不强制选任务）。 */
export type BlockerContext = {
  projectId: string;
  taskId: string | null;
  reason: BlockerReason;
};

// 组装候选人信号。四个信号各一条查询，皆按 projectId 收口——不跨项目取数，
// 否则刚建的项目会因别的项目的历史而推荐出不相干的人。
export async function suggestHelpers(
  actorId: string,
  ctx: BlockerContext,
  opts?: { limit?: number },
): Promise<HelperSuggestion[]> {
  const access = await getProjectForUser(actorId, ctx.projectId);
  if (!access) return [];

  const members = await db
    .select({ userId: teamMembers.userId, name: users.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, access.project.teamId));

  // 排除发起人自己：推荐自己帮自己没有意义
  const pool = members.filter((m) => m.userId !== actorId && m.role !== "teacher");
  if (pool.length === 0) return [];
  const ids = pool.map((m) => m.userId);

  const [projectTasks, milestoneId, labelIds, resolvedBlockers] = await Promise.all([
    db
      .select({
        id: tasks.id,
        status: tasks.status,
        assigneeId: tasks.assigneeId,
        milestoneId: tasks.milestoneId,
      })
      .from(tasks)
      .where(eq(tasks.projectId, ctx.projectId)),
    // 阻塞所指任务的里程碑
    ctx.taskId
      ? db
          .select({ milestoneId: tasks.milestoneId })
          .from(tasks)
          .where(eq(tasks.id, ctx.taskId))
          .then((r) => r[0]?.milestoneId ?? null)
      : Promise.resolve(null),
    // 阻塞所指任务的标签
    ctx.taskId
      ? db
          .select({ labelId: taskLabels.labelId })
          .from(taskLabels)
          .where(eq(taskLabels.taskId, ctx.taskId))
          .then((r) => r.map((x) => x.labelId))
      : Promise.resolve([] as string[]),
    db
      .select({ resolvedById: blockers.resolvedById, count: sql<number>`count(*)::int` })
      .from(blockers)
      .where(
        and(
          eq(blockers.projectId, ctx.projectId),
          eq(blockers.reason, ctx.reason),
          eq(blockers.status, "resolved"),
          isNotNull(blockers.resolvedById),
        ),
      )
      .groupBy(blockers.resolvedById),
  ]);

  // 同里程碑下各人已完成数
  const doneByMilestone = new Map<string, number>();
  if (milestoneId) {
    for (const t of projectTasks) {
      if (t.status === "done" && t.milestoneId === milestoneId && t.assigneeId) {
        doneByMilestone.set(t.assigneeId, (doneByMilestone.get(t.assigneeId) ?? 0) + 1);
      }
    }
  }

  // 共享标签且已完成的任务，按人计数
  const doneByLabel = new Map<string, number>();
  if (labelIds.length > 0) {
    const shared = await db
      .select({ assigneeId: tasks.assigneeId, count: sql<number>`count(*)::int` })
      .from(taskLabels)
      .innerJoin(tasks, eq(taskLabels.taskId, tasks.id))
      .where(
        and(
          inArray(taskLabels.labelId, labelIds),
          eq(tasks.projectId, ctx.projectId),
          eq(tasks.status, "done"),
          inArray(tasks.assigneeId, ids),
        ),
      )
      .groupBy(tasks.assigneeId);
    for (const r of shared) if (r.assigneeId) doneByLabel.set(r.assigneeId, r.count);
  }

  const helpedBy = new Map(resolvedBlockers.map((r) => [r.resolvedById!, r.count]));

  const loadBy = new Map<string, number>();
  for (const t of projectTasks) {
    if (t.assigneeId && isInFlight(t.status)) {
      loadBy.set(t.assigneeId, (loadBy.get(t.assigneeId) ?? 0) + 1);
    }
  }

  const candidates: HelperCandidate[] = pool.map((m) => ({
    userId: m.userId,
    name: m.name,
    load: loadBy.get(m.userId) ?? 0,
    proximityMilestone: doneByMilestone.get(m.userId) ?? 0,
    proximityLabel: doneByLabel.get(m.userId) ?? 0,
    helpCount: helpedBy.get(m.userId) ?? 0,
  }));

  return rankHelpers(candidates, opts);
}
