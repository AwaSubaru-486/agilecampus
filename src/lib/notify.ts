import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, teamMembers, users, projects } from "@/db/schema";
import { sendCardMessage } from "./feishu";
import { today } from "./today";
import {
  buildAssignedCard,
  buildBlockerCard,
  buildCompletedCard,
  buildDeclinedCard,
  buildDueReminderCard,
  buildReviewedCard,
  buildSubmittedCard,
  type CardTask,
  type ReminderItem,
} from "./feishu-card";

// notify 收的 task 来自 createTask/updateTask 返回 row，含 projectId/priority
type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  assigneeId: string | null;
  projectId: string;
  priority: string;
  completionNote?: string | null;
  createdById?: string | null;
};

// 取用户 open_id（未绑返回 null）
async function openIdOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ openId: users.feishuOpenId }).from(users).where(eq(users.id, userId));
  return row?.openId ?? null;
}

// 补查卡片所需的 项目名 / 负责人名
async function enrich(task: TaskRow): Promise<CardTask> {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, task.projectId));
  let assigneeName: string | null = null;
  if (task.assigneeId) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, task.assigneeId));
    assigneeName = u?.name ?? null;
  }
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    projectName: proj?.name ?? "（未知项目）",
    assigneeName,
    dueDate: task.dueDate,
    priority: task.priority,
    completionNote: task.completionNote ?? null,
  };
}

// 统一发送：失败仅记日志，绝不抛（fire-and-forget，通知不得阻断主业务）
async function safeSend(openId: string, card: unknown): Promise<boolean> {
  try {
    await sendCardMessage(openId, card);
    return true;
  } catch (e) {
    console.error("[notify] 飞书发送失败", e);
    return false;
  }
}

export async function notifyTaskAssigned(task: TaskRow): Promise<void> {
  if (!task.assigneeId) return;
  const openId = await openIdOf(task.assigneeId);
  if (!openId) return;
  await safeSend(openId, buildAssignedCard(await enrich(task)));
}

export async function notifyTaskCompleted(task: TaskRow, actorId: string): Promise<void> {
  const creatorId = task.createdById ?? null;
  if (!creatorId || creatorId === actorId) return;
  const openId = await openIdOf(creatorId);
  if (!openId) return;
  await safeSend(openId, buildCompletedCard(await enrich(task)));
}

// 接不住 → 通知派活的人（任务创建者），让他改派或换做法。
//
// 与验收退回不同：退回是「做出来的不对」，接不住是「压根没做」。
// 后者更需要立刻知道——球已经落在地上，而派活的人还以为在飞。
export async function notifyTaskDeclined(
  task: TaskRow,
  actorId: string,
  reason: string,
): Promise<void> {
  const creatorId = task.createdById ?? null;
  // 自己派给自己又自己接不住，不必给自己发通知
  if (!creatorId || creatorId === actorId) return;
  const openId = await openIdOf(creatorId);
  if (!openId) return;
  await safeSend(openId, buildDeclinedCard(await enrich(task), reason));
}

// 项目的验收人：团队内的 admin 与 teacher。直接查库而不复用 listTeamMembers，
// 为的是顺带滤掉未绑飞书者，省一次往返；提交人自己排除在外（不给自己发待验收）。
async function reviewerOpenIds(projectId: string, excludeUserId: string | null): Promise<string[]> {
  const conds = [
    eq(projects.id, projectId),
    inArray(teamMembers.role, ["admin", "teacher"] as const),
    isNotNull(users.feishuOpenId),
  ];
  if (excludeUserId) conds.push(ne(teamMembers.userId, excludeUserId));

  const rows = await db
    .select({ openId: users.feishuOpenId })
    .from(teamMembers)
    .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(and(...conds));
  return rows.map((r) => r.openId).filter((x): x is string => Boolean(x));
}

// 提交成果 → 通知全部验收人。这是「待验收」第一次有人知道，
// 在此之前球停在中场，无人察觉。
export async function notifyTaskSubmitted(task: TaskRow): Promise<void> {
  const openIds = await reviewerOpenIds(task.projectId, task.assigneeId);
  if (openIds.length === 0) return;
  const card = buildSubmittedCard(await enrich(task));
  for (const openId of openIds) await safeSend(openId, card);
}

// 验收结果 → 通知提交人。退回必带理由，故卡片上一定有话可看。
export async function notifyTaskReviewed(
  task: TaskRow,
  decision: "accept" | "reject",
  note: string | null,
  actorId: string,
): Promise<void> {
  if (!task.assigneeId || task.assigneeId === actorId) return;
  const openId = await openIdOf(task.assigneeId);
  if (!openId) return;
  await safeSend(openId, buildReviewedCard(await enrich(task), decision, note));
}

// 求助 → 通知被点名的人，以及本项目的组长与教师。
//
// 这与「任务指派」不同：指派是告知，求助是求援，收件人需要真的动一下。
// 故即便没人被点名也要发给组长与教师——否则一条求助发出去可能一个人都不知道。
export async function notifyBlockerRaised(input: {
  projectId: string;
  raisedById: string;
  reasonLabel: string;
  detail: string | null;
  helpNeeded: string | null;
  taskId: string | null;
  inviteeIds: string[];
}): Promise<void> {
  const [proj] = await db
    .select({ name: projects.name, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, input.projectId));
  if (!proj) return;

  const [raiser] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, input.raisedById));

  let taskTitle: string | null = null;
  if (input.taskId) {
    const [t] = await db
      .select({ title: tasks.title })
      .from(tasks)
      .where(eq(tasks.id, input.taskId));
    taskTitle = t?.title ?? null;
  }

  // 收件人 = 被点名者 ∪ 组长 ∪ 教师，去重，排除求助人自己
  const reviewers = await db
    .select({ userId: teamMembers.userId, openId: users.feishuOpenId })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(
      and(
        eq(teamMembers.teamId, proj.teamId),
        inArray(teamMembers.role, ["admin", "teacher"] as const),
        isNotNull(users.feishuOpenId),
      ),
    );

  const invitees =
    input.inviteeIds.length > 0
      ? await db
          .select({ userId: users.id, name: users.name, openId: users.feishuOpenId })
          .from(users)
          .where(inArray(users.id, input.inviteeIds))
      : [];

  const recipients = new Map<string, string>(); // userId → openId
  for (const r of reviewers) {
    if (r.openId && r.userId !== input.raisedById) recipients.set(r.userId, r.openId);
  }
  for (const i of invitees) {
    if (i.openId && i.userId !== input.raisedById) recipients.set(i.userId, i.openId);
  }
  if (recipients.size === 0) return;

  const card = buildBlockerCard({
    projectId: input.projectId,
    projectName: proj.name,
    raisedByName: raiser?.name ?? "某位成员",
    reasonLabel: input.reasonLabel,
    detail: input.detail,
    helpNeeded: input.helpNeeded,
    taskTitle,
    inviteeNames: invitees.filter((i) => i.userId !== input.raisedById).map((i) => i.name),
  });

  for (const openId of recipients.values()) await safeSend(openId, card);
}

// 扫全库临期(明日到期)+逾期(已过期未 done)，按负责人聚合为一封卡片日报。返回发送人数与扫描任务数。
export async function scanAndNotifyDue(): Promise<{ notified: number; tasksScanned: number }> {
  // 临期/逾期：status≠done 且 dueDate ≤ 明日（含逾期），且负责人已绑飞书
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      projectId: tasks.projectId,
      openId: users.feishuOpenId,
    })
    .from(tasks)
    .innerJoin(users, eq(tasks.assigneeId, users.id))
    .where(
      and(
        // 只催在办的活。待验收的不催负责人——球已交到验收人脚下，
        // 此时催他等于系统不懂他干了什么，比不催更伤。
        // 待验收的催办归验收人，随「验收」一图补上。
        inArray(tasks.status, ["todo", "doing"]),
        isNotNull(tasks.dueDate),
        isNotNull(users.feishuOpenId),
        // dueDate <= 明日（date 列与 CURRENT_DATE 比较）
        sql`${tasks.dueDate} <= CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

  // 按负责人聚合
  const byUser = new Map<string, { openId: string; overdue: ReminderItem[]; dueSoon: ReminderItem[] }>();
  const todayStr = today();
  for (const r of rows) {
    if (!r.assigneeId || !r.openId) continue;
    const bucket = byUser.get(r.assigneeId) ?? { openId: r.openId, overdue: [], dueSoon: [] };
    const item: ReminderItem = { id: r.id, title: r.title, projectId: r.projectId };
    if (r.dueDate && r.dueDate < todayStr) bucket.overdue.push(item);
    else bucket.dueSoon.push(item);
    byUser.set(r.assigneeId, bucket);
  }

  let notified = 0;
  for (const { openId, overdue, dueSoon } of byUser.values()) {
    const ok = await safeSend(openId, buildDueReminderCard({ overdue, dueSoon }));
    if (ok) notified++;
  }
  return { notified, tasksScanned: rows.length };
}
