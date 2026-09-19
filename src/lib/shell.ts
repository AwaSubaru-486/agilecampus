import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks, teamMembers, users } from "@/db/schema";
import { today } from "./today";

// 工作带与「今日」页共用的取数。
//
// 两处必须同源：工作带上的徽章说有 3 件事等你，点进去就得看到 3 件。
// 各算各的，迟早对不上。

export type ActionItem = {
  taskId: string;
  title: string;
  projectId: string;
  projectName: string;
  assigneeName: string | null;
  dueDate: string | null;
  overdue: boolean;
};

// 只查「需要我做决定」的，不查「正在进行中」的——后者属于浏览，
// 不该占掉行动队列的位置。旧版把两者混在一起，真正要动手的事
// 就被淹没在一堆状态里。
export async function listMyActionItems(userId: string): Promise<{
  awaiting: ActionItem[];
  toReview: ActionItem[];
}> {
  const memberships = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  if (memberships.length === 0) return { awaiting: [], toReview: [] };

  const day = today();
  const selection = {
    taskId: tasks.id,
    title: tasks.title,
    projectId: projects.id,
    projectName: projects.name,
    assigneeName: users.name,
    dueDate: tasks.dueDate,
  };
  const mark = (rows: Omit<ActionItem, "overdue">[]): ActionItem[] =>
    rows.map((r) => ({ ...r, overdue: Boolean(r.dueDate && r.dueDate < day) }));

  // 派给我、我还没回话的
  const awaiting = await db
    .select(selection)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(
      and(
        eq(tasks.assigneeId, userId),
        isNull(tasks.committedAt),
        inArray(tasks.status, ["todo", "doing"]),
      ),
    );

  // 待我验收：我在这几个团队里是老师或组长
  const reviewerTeamIds = memberships.filter((m) => m.role !== "student").map((m) => m.teamId);
  const toReview =
    reviewerTeamIds.length === 0
      ? []
      : await db
          .select(selection)
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .leftJoin(users, eq(tasks.assigneeId, users.id))
          .where(and(eq(tasks.status, "review"), inArray(projects.teamId, reviewerTeamIds)));

  return { awaiting: mark(awaiting), toReview: mark(toReview) };
}

// 工作带上那个「待我处理」的数字。
//
// Commit 2 先只数「派给我、我还回话」的交接——它是个真实数字，
// 而且正是这个产品最想让人看见的状态。
// Commit 4 建完整行动队列时，这里改为直接取 listMyActionItems 的长度，
// 与队列同源，免得徽章说有 3 项、点进去只看到 2 项。
export async function countMyPendingActions(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.assigneeId, userId),
        isNull(tasks.committedAt),
        inArray(tasks.status, ["todo", "doing"]),
      ),
    );
  return row?.count ?? 0;
}
