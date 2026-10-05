import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, blockerInvites, blockers, teamMembers, users } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";

// 项目贡献记录。
//
// 全部从活动流与求助记录算出，**不需要任何人填写一个字**。
// 这是「贡献记录零填写」的字面实现：事件由执行写入的那段代码发出，
// 不由任何界面动作发出，故没有「忘了记」这回事。
//
// 但有几件事算不出来，且必须写在页面上说清楚（见 NOT_MEASURABLE）。
// 一份让人误以为全面的贡献表，比一份明说局限的表有害得多。

export type ContributionRow = {
  userId: string;
  name: string;
  /** 头条数字：被验收通过的任务数。刻意不用「创建数」——那个可以灌水 */
  acceptedCount: number;
  /** 提交待验收的次数（含被退回的） */
  submittedCount: number;
  /** 认领并立下承诺的次数 */
  claimedCount: number;
  /** 承诺过的预估工时合计 */
  estimatedHours: number;
  /** 解决他人求助的次数（不含自己报的） */
  helpedOthersCount: number;
  /** 被推荐去帮忙的次数，与上一条对照看「推荐准不准」 */
  invitedCount: number;
  /** 参与验收（通过或退回）的次数 */
  reviewedCount: number;
  /** 自己交付被退回的次数——返工成本 */
  rejectedCount: number;
  /** 有活动记录的 distinct 任务数，用于对抗「所有事都在一个人手里」 */
  touchedTaskCount: number;
  /** 首末活动时间与活跃天数 */
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
  activeDays: number;
};

export type ContributionReport = {
  rows: ContributionRow[];
  /** 阻塞分析：原因分布与平均解决时长 */
  blockerStats: {
    total: number;
    resolved: number;
    open: number;
    avgResolveHours: number | null;
    byReason: { reason: string; count: number }[];
  };
  /** 验收：通过率与退回次数 */
  reviewStats: { accepted: number; rejected: number; rejectRate: number | null };
  /** 项目起止：首条事件到最后一条 */
  span: { firstAt: Date | null; lastAt: Date | null; totalEvents: number };
};

// 算不出来的维度。必须上界面，不能只写在代码注释里。
export const NOT_MEASURABLE = [
  "实际投入时长——只知承诺工时与提交时刻，无法区分挂机与苦干",
  "工作质量——退回次数只是代理，且受验收人严格程度影响，跨项目不可比",
  "线下贡献——访谈、跑实验、开会、写论文，系统里没有痕迹",
  "帮助的强度——只有「标记为已解决」是硬证据，其余一概算不上",
  "任务难度——一个任务不等于一个任务，自报工时亦可注水",
  "协作氛围——是否愿意开口求助、是否互相体谅，数据看不到",
] as const;

function emptyRow(userId: string, name: string): ContributionRow {
  return {
    userId,
    name,
    acceptedCount: 0,
    submittedCount: 0,
    claimedCount: 0,
    estimatedHours: 0,
    helpedOthersCount: 0,
    invitedCount: 0,
    reviewedCount: 0,
    rejectedCount: 0,
    touchedTaskCount: 0,
    firstActiveAt: null,
    lastActiveAt: null,
    activeDays: 0,
  };
}

type Payload = Record<string, unknown> | null;

function pickString(p: Payload, key: string): string | null {
  const v = p?.[key];
  return typeof v === "string" ? v : null;
}

export async function buildContributionReport(
  actorId: string,
  projectId: string,
): Promise<ContributionReport> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [events, members, blockerRows, inviteRows] = await Promise.all([
    db
      .select({
        type: activityEvents.type,
        actorId: activityEvents.actorId,
        taskId: activityEvents.taskId,
        payload: activityEvents.payload,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .where(eq(activityEvents.projectId, projectId))
      .orderBy(activityEvents.createdAt),
    db
      .select({ id: teamMembers.userId, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, access.project.teamId)),
    db
      .select({
        id: blockers.id,
        reason: blockers.reason,
        status: blockers.status,
        raisedById: blockers.raisedById,
        resolvedById: blockers.resolvedById,
        createdAt: blockers.createdAt,
        resolvedAt: blockers.resolvedAt,
      })
      .from(blockers)
      .where(eq(blockers.projectId, projectId)),
    db
      .select({ inviteeId: blockerInvites.inviteeId, blockerId: blockerInvites.blockerId })
      .from(blockerInvites)
      .innerJoin(blockers, eq(blockerInvites.blockerId, blockers.id))
      .where(eq(blockers.projectId, projectId)),
  ]);

  const byUser = new Map<string, ContributionRow>();
  for (const m of members) byUser.set(m.id, emptyRow(m.id, m.name));

  // 每人有活动的日子，用于「活跃天数」
  const daysByUser = new Map<string, Set<string>>();
  const tasksByUser = new Map<string, Set<string>>();

  let firstAt: Date | null = null;
  let lastAt: Date | null = null;

  for (const e of events) {
    if (!firstAt || e.createdAt < firstAt) firstAt = e.createdAt;
    if (!lastAt || e.createdAt > lastAt) lastAt = e.createdAt;

    const payload = e.payload as Payload;
    // 交付人取自冻结在事件里的 assigneeId，而非当前任务行——
    // 任务事后可能改派，事后再查会张冠李戴
    const deliverer = pickString(payload, "assigneeId");

    if (e.actorId) {
      const row = byUser.get(e.actorId);
      if (row) {
        if (!row.firstActiveAt || e.createdAt < row.firstActiveAt) row.firstActiveAt = e.createdAt;
        if (!row.lastActiveAt || e.createdAt > row.lastActiveAt) row.lastActiveAt = e.createdAt;
        const day = e.createdAt.toISOString().slice(0, 10);
        const set = daysByUser.get(e.actorId) ?? new Set<string>();
        set.add(day);
        daysByUser.set(e.actorId, set);
        if (e.taskId) {
          const ts = tasksByUser.get(e.actorId) ?? new Set<string>();
          ts.add(e.taskId);
          tasksByUser.set(e.actorId, ts);
        }
      }
    }

    switch (e.type) {
      case "task_accepted": {
        if (deliverer) {
          const r = byUser.get(deliverer);
          if (r) r.acceptedCount++;
        }
        if (e.actorId) {
          const r = byUser.get(e.actorId);
          if (r) r.reviewedCount++;
        }
        break;
      }
      case "task_rejected": {
        if (deliverer) {
          const r = byUser.get(deliverer);
          if (r) r.rejectedCount++;
        }
        if (e.actorId) {
          const r = byUser.get(e.actorId);
          if (r) r.reviewedCount++;
        }
        break;
      }
      case "task_submitted": {
        if (deliverer) {
          const r = byUser.get(deliverer);
          if (r) r.submittedCount++;
        }
        break;
      }
      case "task_claimed": {
        if (e.actorId) {
          const r = byUser.get(e.actorId);
          if (r) {
            r.claimedCount++;
            const h = payload?.["estimatedHours"];
            if (typeof h === "number") r.estimatedHours += h;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // 互助：只认「解决了别人的求助」。被邀请不算——邀请只是有人觉得他可能行，
  // 与真的帮上忙是两回事
  for (const b of blockerRows) {
    if (b.status === "resolved" && b.resolvedById && b.resolvedById !== b.raisedById) {
      const r = byUser.get(b.resolvedById);
      if (r) r.helpedOthersCount++;
    }
  }
  for (const i of inviteRows) {
    const r = byUser.get(i.inviteeId);
    if (r) r.invitedCount++;
  }

  for (const [id, row] of byUser) {
    row.activeDays = daysByUser.get(id)?.size ?? 0;
    row.touchedTaskCount = tasksByUser.get(id)?.size ?? 0;
  }

  const resolvedWithTime = blockerRows.filter((b) => b.status === "resolved" && b.resolvedAt);
  const avgResolveHours =
    resolvedWithTime.length > 0
      ? Math.round(
          resolvedWithTime.reduce(
            (sum, b) => sum + (b.resolvedAt!.getTime() - b.createdAt.getTime()) / 3_600_000,
            0,
          ) / resolvedWithTime.length,
        )
      : null;

  const reasonCount = new Map<string, number>();
  for (const b of blockerRows) reasonCount.set(b.reason, (reasonCount.get(b.reason) ?? 0) + 1);

  const accepted = events.filter((e) => e.type === "task_accepted").length;
  const rejected = events.filter((e) => e.type === "task_rejected").length;

  return {
    // 交付多的排前面；交付相同则看互助——排序本身即一种价值取向，
    // 故把「帮了别人」放在第二顺位而不是「创建了多少任务」
    rows: [...byUser.values()].sort(
      (a, b) =>
        b.acceptedCount - a.acceptedCount ||
        b.helpedOthersCount - a.helpedOthersCount ||
        a.name.localeCompare(b.name, "zh"),
    ),
    blockerStats: {
      total: blockerRows.length,
      resolved: blockerRows.filter((b) => b.status === "resolved").length,
      open: blockerRows.filter((b) => b.status === "open").length,
      avgResolveHours,
      byReason: [...reasonCount.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
    reviewStats: {
      accepted,
      rejected,
      rejectRate: accepted + rejected > 0 ? Math.round((rejected / (accepted + rejected)) * 100) : null,
    },
    span: { firstAt, lastAt, totalEvents: events.length },
  };
}
