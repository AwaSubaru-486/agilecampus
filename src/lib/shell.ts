import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, blockerInvites, blockers, decisions, projects, tasks, teamMembers, users } from "@/db/schema";
import { buildActionQueue, type RawAction } from "./action-queue";
import { today } from "./today";

// 行动队列的取数。
//
// 列表与徽章必须同源——验收报告 P1-3 指出的正是这个：徽章只数待回应，
// 今日页却还列了待验收，同一屏上两个数字互相打脸。
// 现在两者都从 loadActionQueue 来，徽章取 items.length。

const DAY_MS = 86_400_000;

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export type ActionQueue = {
  items: RawAction[];
  /** 被截掉的条数。界面据此显示「另有 N 件」 */
  omitted: number;
  /** 未截断的总数 */
  total: number;
};

export async function loadActionQueue(
  userId: string,
  opts?: { showAll?: boolean },
): Promise<ActionQueue> {
  const [memberships, actorRows] = await Promise.all([
    db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId)),
    db.select({ kind: users.kind }).from(users).where(eq(users.id, userId)),
  ]);
  if (memberships.length === 0) return { items: [], omitted: 0, total: 0 };

  const teamIds = memberships.map((m) => m.teamId);
  const reviewerTeamIds = memberships.filter((m) => m.role !== "student").map((m) => m.teamId);
  const day = today();
  const soon = addDays(day, 3);

  // 归档项目不再打扰人——它已经结束了。这一条不写会让人被半年前的
  // 逾期任务永久追着跑
  const liveProjects = and(inArray(projects.teamId, teamIds), ne(projects.status, "archived"));

  const taskBase = {
    taskId: tasks.id,
    title: tasks.title,
    projectId: projects.id,
    projectName: projects.name,
    dueDate: tasks.dueDate,
    reviewNote: tasks.reviewNote,
    updatedAt: tasks.updatedAt,
    creatorName: users.name,
  };
  const [awaiting, toReview, rejected, overdue, dueSoon, invited, pendingDecisions, pendingApprovals] = await Promise.all([
    // 派给我、我还没回话
    db
      .select(taskBase)
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.createdById, users.id))
      .where(
        and(
          liveProjects,
          eq(tasks.assigneeId, userId),
          isNull(tasks.committedAt),
          inArray(tasks.status, ["todo", "doing"]),
        ),
      ),

    // 待我验收：我在这几个团队里是老师或组长
    reviewerTeamIds.length === 0
      ? Promise.resolve([])
      : db
          .select(taskBase)
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .leftJoin(users, eq(tasks.assigneeId, users.id))
          .where(
            and(
              liveProjects,
              inArray(projects.teamId, reviewerTeamIds),
              eq(tasks.status, "review"),
            ),
          ),

    // 我的交付被退回过，正待重做
    db
      .select(taskBase)
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.createdById, users.id))
      .where(
        and(
          liveProjects,
          eq(tasks.assigneeId, userId),
          eq(tasks.status, "doing"),
          gt(tasks.rejectCount, 0),
        ),
      ),

    // 我负责的、已过期
    db
      .select(taskBase)
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.createdById, users.id))
      .where(
        and(
          liveProjects,
          eq(tasks.assigneeId, userId),
          inArray(tasks.status, ["todo", "doing", "review"]),
          isNotNull(tasks.dueDate),
          lte(tasks.dueDate, day),
        ),
      ),

    // 我负责的、三天内到期
    db
      .select(taskBase)
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.createdById, users.id))
      .where(
        and(
          liveProjects,
          eq(tasks.assigneeId, userId),
          inArray(tasks.status, ["todo", "doing"]),
          isNotNull(tasks.dueDate),
          gt(tasks.dueDate, day),
          lte(tasks.dueDate, soon),
        ),
      ),

    // 点名请我搭手的求助
    db
      .select({
        blockerId: blockers.id,
        reason: blockers.reason,
        helpNeeded: blockers.helpNeeded,
        projectId: projects.id,
        projectName: projects.name,
        at: blockers.createdAt,
      })
      .from(blockerInvites)
      .innerJoin(blockers, eq(blockerInvites.blockerId, blockers.id))
      .innerJoin(projects, eq(blockers.projectId, projects.id))
      .where(
        and(
          liveProjects,
          eq(blockerInvites.inviteeId, userId),
          eq(blockers.status, "open"),
        ),
      ),

    // AI 只能提出方案，待确认决策由人处理；AI 成员不应收到这类行动。
    actorRows[0]?.kind === "human"
      ? db
          .select({
            decisionId: decisions.id,
            title: decisions.title,
            projectId: projects.id,
            projectName: projects.name,
            createdAt: decisions.createdAt,
          })
          .from(decisions)
          .innerJoin(projects, eq(decisions.projectId, projects.id))
          .where(and(liveProjects, eq(decisions.status, "proposed")))
      : Promise.resolve([]),
    // AI 写操作与决策一样，先进入人的队列，不能在生成时直接写入业务表。
    actorRows[0]?.kind === "human"
      ? db
          .select({
            approvalId: approvalRequests.id,
            title: approvalRequests.title,
            projectId: projects.id,
            projectName: projects.name,
            status: approvalRequests.status,
            createdAt: approvalRequests.createdAt,
          })
          .from(approvalRequests)
          .innerJoin(projects, eq(approvalRequests.projectId, projects.id))
          .where(
            and(
              liveProjects,
              inArray(approvalRequests.status, ["pending", "failed"]),
            ),
          )
      : Promise.resolve([]),
  ]);

  const raw: RawAction[] = [
    ...awaiting.map((r) => ({
      kind: "assignment_response" as const,
      taskId: r.taskId,
      blockerId: null,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      context: r.creatorName ? `${r.creatorName} 派的` : null,
      dueDate: r.dueDate,
      at: r.updatedAt,
    })),
    ...toReview.map((r) => ({
      kind: "review" as const,
      taskId: r.taskId,
      blockerId: null,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      context: r.creatorName ? `交自 ${r.creatorName}` : null,
      dueDate: r.dueDate,
      at: r.updatedAt,
    })),
    ...rejected.map((r) => ({
      kind: "rejected_work" as const,
      taskId: r.taskId,
      blockerId: null,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      context: r.reviewNote,
      dueDate: r.dueDate,
      at: r.updatedAt,
    })),
    ...overdue.map((r) => ({
      kind: "overdue" as const,
      taskId: r.taskId,
      blockerId: null,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      context: r.dueDate ? `截止 ${r.dueDate}` : null,
      dueDate: r.dueDate,
      at: r.updatedAt,
    })),
    ...dueSoon.map((r) => ({
      kind: "due_soon" as const,
      taskId: r.taskId,
      blockerId: null,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      context: r.dueDate ? `截止 ${r.dueDate}` : null,
      dueDate: r.dueDate,
      at: r.updatedAt,
    })),
    ...invited.map((r) => ({
      kind: "blocker_invite" as const,
      taskId: null,
      blockerId: r.blockerId,
      title: r.helpNeeded ?? "有人请你搭手",
      projectId: r.projectId,
      projectName: r.projectName,
      context: null,
      dueDate: null,
      at: r.at,
    })),
    ...pendingDecisions.map((r) => ({
      kind: "decision_review" as const,
      taskId: null,
      blockerId: null,
      decisionId: r.decisionId,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      context: "AI 方案待确认",
      dueDate: null,
      at: r.createdAt,
    })),
    ...pendingApprovals.map((r) => ({
      kind: "approval_review" as const,
      taskId: null,
      blockerId: null,
      approvalId: r.approvalId,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      context: r.status === "failed" ? "上次执行失败，可重试" : "AI 写操作待确认",
      dueDate: null,
      at: r.createdAt,
    })),
  ];

  const { items, omitted } = buildActionQueue(raw, { showAll: opts?.showAll });
  return { items, omitted, total: raw.length };
}

/** 工作带徽章上的数字——与今日页同源，不会再打架。 */
export async function countMyPendingActions(userId: string): Promise<number> {
  const { total } = await loadActionQueue(userId, { showAll: true });
  return total;
}

// 保留给「自己的活」的窄查询：今日页的「正在推进」一栏要用
export async function listMyOpenTasks(userId: string) {
  const teamIds = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  if (teamIds.length === 0) return [];

  return db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      committedAt: tasks.committedAt,
      projectId: projects.id,
      projectName: projects.name,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        inArray(
          projects.teamId,
          teamIds.map((t) => t.teamId),
        ),
        eq(tasks.assigneeId, userId),
        notInArray(tasks.status, ["done"]),
        ne(projects.status, "archived"),
      ),
    )
    .orderBy(sql`${tasks.updatedAt} desc`)
    .limit(20);
}
