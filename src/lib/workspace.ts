import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, agents, tasks, teamMembers, users, type AgentStatus } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { listProjectBlockers } from "./blocker";
import { isInFlight } from "./task-status";

/** 「正在发生」里的一个人（或一个 AI）。类型放这里，组件反向引用它。 */
export type LiveMember = {
  id: string;
  name: string;
  kind: "human" | "agent";
  /** agent 才有 */
  agentStatus: AgentStatus | null;
  /** 此刻在做的那件事 */
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  /** 最近动过的时刻 */
  lastAt: Date | null;
  /** 卡住的原因，非空即卡着 */
  stuck: string | null;
  /** 还没接住的活有几件 */
  awaitingCount: number;
};

// 「正在发生」的取数。
//
// 一屏之内看见团队此刻在干什么——人跟 AI 混在一起，谁在动、谁卡住、谁还没回话。
// 与看板的分工：看板是「每件事在哪个状态」，这里是「每个人（和 AI）在干什么」。
// 视角的差别看着小，但它决定了打开项目先看到什么。

export async function buildLiveBoard(
  actorId: string,
  projectId: string,
): Promise<LiveMember[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const teamId = access.project.teamId;

  const [roster, taskRows, openBlockers, lastEvents, agentRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, kind: users.kind })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId)),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        assigneeId: tasks.assigneeId,
        committedAt: tasks.committedAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId)),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
    // 每人最近一次动作，用于「多久没动了」
    db
      .select({
        actorId: activityEvents.actorId,
        lastAt: sql<Date>`max(${activityEvents.createdAt})`,
      })
      .from(activityEvents)
      .where(eq(activityEvents.projectId, projectId))
      .groupBy(activityEvents.actorId),
    db
      .select({ userId: agents.userId, status: agents.status })
      .from(agents)
      .where(eq(agents.teamId, teamId)),
  ]);

  const agentStatusById = new Map(agentRows.map((a) => [a.userId, a.status]));
  const lastAtById = new Map(lastEvents.filter((e) => e.actorId).map((e) => [e.actorId!, e.lastAt]));

  // 卡住的任务 → 原因。取所有人可见的那条求助。
  const stuckByTask = new Map<string, string>();
  for (const b of openBlockers) {
    if (b.taskId && !stuckByTask.has(b.taskId)) {
      stuckByTask.set(b.taskId, b.helpNeeded ?? b.detail ?? "有人求助了");
    }
  }

  const live: LiveMember[] = roster.map((m) => {
    // 分给这个人的活：优先取在办中最近动过的那件
    const mine = taskRows
      .filter((t) => t.assigneeId === m.id && isInFlight(t.status))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // 还没接住的：派了但本人没回话
    const awaiting = mine.filter((t) => !t.committedAt);

    // 正在做的那件：已接住、且没被卡住
    const doing = mine.find((t) => t.committedAt && !stuckByTask.has(t.id)) ?? null;
    // 若全都卡着，就挑一件卡着的显示——卡着比「在做」更该被看见
    const stuckTask = mine.find((t) => stuckByTask.has(t.id)) ?? null;
    const focus = stuckTask ?? doing;

    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      agentStatus: agentStatusById.get(m.id) ?? null,
      taskId: focus?.id ?? null,
      taskTitle: focus?.title ?? null,
      taskStatus: focus?.status ?? null,
      lastAt: lastAtById.get(m.id) ?? null,
      stuck: stuckTask ? (stuckByTask.get(stuckTask.id) ?? null) : null,
      awaitingCount: awaiting.length,
    };
  });

  // 排序：卡住的排最前，然后在做、待回应、空闲；同级按最近活动倒序。
  // 「卡住的排最前」是有意的——那是最需要有人动一下的。
  const rank = (m: LiveMember) =>
    m.stuck ? 0 : m.taskId ? 1 : m.awaitingCount > 0 ? 2 : 3;
  live.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0) ||
      a.name.localeCompare(b.name, "zh"),
  );

  return live;
}
