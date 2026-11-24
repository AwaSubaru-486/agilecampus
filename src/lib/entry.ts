import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectEntries, tasks, teamMembers, users } from "@/db/schema";
import { ENTRY_LABEL, type EntryType } from "./entry-labels";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { describe, recordEvent } from "./activity";

// 项目档案：老师反馈、文档、成果链接。
//
// 三者共用一张表（理由见 schema 注释）。此处只按类型分派权限：
//   反馈 —— 老师或组长留，学生看。这是「谁在指导这个项目」的痕迹
//   文档、成果 —— 项目成员都可以添，这是团队共有的产出
//
// 读取一律项目成员可见：档案是给整个团队看的，不是私人物品。

export type EntryInput = {
  type: EntryType;
  title: string;
  content?: string;
  url?: string;
  /** 挂在某件任务上 */
  taskId?: string | null;
};

// 文案从叶子模块取，服务端与客户端共用一份
export { ENTRY_LABEL } from "./entry-labels";

/** 一批 entry 的展示名与作者身份，供界面直接渲染 */
export type EntryRow = {
  id: string;
  type: EntryType;
  title: string;
  content: string | null;
  url: string | null;
  taskId: string | null;
  taskTitle: string | null;
  authorId: string | null;
  authorName: string | null;
  /** 作者此刻在这个团队里的角色，用来把「老师说的」和「同学说的」分开 */
  authorRole: "admin" | "teacher" | "student" | null;
  authorKind: "human" | "agent" | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function createEntry(actorId: string, projectId: string, input: EntryInput) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  // 反馈是指导性的话，只有老师与组长说得。
  // 学生若也有这个入口，「老师反馈」四个字就不再意味着什么了。
  if (input.type === "feedback" && access.role !== "teacher" && access.role !== "admin") {
    throw new ForbiddenError("只有老师或组长可以留反馈");
  }

  const title = input.title.trim();
  if (!title) throw new AppError("请写个标题");
  if (input.type === "deliverable" && !input.url?.trim()) {
    throw new AppError("成果要附一个链接");
  }
  if (input.url?.trim() && !/^https?:\/\//i.test(input.url.trim())) {
    throw new AppError("链接要以 http:// 或 https:// 开头");
  }
  if (input.taskId) {
    const [t] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, input.taskId));
    if (!t) throw new AppError("任务不存在");
    if (t.projectId !== projectId) throw new AppError("任务不属于该项目");
  }

  const [entry] = await db
    .insert(projectEntries)
    .values({
      projectId,
      taskId: input.taskId ?? null,
      type: input.type,
      title,
      content: input.content?.trim() || null,
      url: input.url?.trim() || null,
      authorId: actorId,
    })
    .returning();

  await recordEvent(db, {
    projectId,
    actorId,
    // 老师留反馈是件该被看见的事，走专门的类型，好让活动流里能筛出来
    type: "entry_created",
    taskId: input.taskId ?? null,
    summary: describe.entryCreated(ENTRY_LABEL[input.type], title),
    payload: { title, entryType: input.type, url: entry.url },
  });

  return entry;
}

export async function listProjectEntries(
  actorId: string,
  projectId: string,
  opts?: { types?: EntryType[]; limit?: number },
): Promise<EntryRow[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const conds = [eq(projectEntries.projectId, projectId)];
  if (opts?.types?.length) conds.push(inArray(projectEntries.type, opts.types));

  const rows = await db
    .select({
      id: projectEntries.id,
      type: projectEntries.type,
      title: projectEntries.title,
      content: projectEntries.content,
      url: projectEntries.url,
      taskId: projectEntries.taskId,
      taskTitle: tasks.title,
      authorId: projectEntries.authorId,
      authorName: users.name,
      authorKind: users.kind,
      authorRole: teamMembers.role,
      createdAt: projectEntries.createdAt,
      updatedAt: projectEntries.updatedAt,
    })
    .from(projectEntries)
    .leftJoin(tasks, eq(projectEntries.taskId, tasks.id))
    .leftJoin(users, eq(projectEntries.authorId, users.id))
    // 作者不再属于本团队时 role 为 null——档案仍要读得出来
    .leftJoin(
      teamMembers,
      and(eq(teamMembers.userId, projectEntries.authorId), eq(teamMembers.teamId, access.project.teamId)),
    )
    .where(and(...conds))
    .orderBy(desc(projectEntries.createdAt))
    .limit(opts?.limit ?? 100);

  return rows;
}

export async function updateEntry(
  actorId: string,
  entryId: string,
  patch: { title?: string; content?: string | null; url?: string | null },
) {
  const [row] = await db.select().from(projectEntries).where(eq(projectEntries.id, entryId));
  if (!row) throw new AppError("这条记录不存在");

  // 只有作者本人或组长能改。老师留的反馈学生改不了——
  // 能改别人的反馈，反馈就不再可信
  const access = await getProjectForUser(actorId, row.projectId);
  if (!access) throw new ForbiddenError();
  if (row.authorId !== actorId && access.role !== "admin") throw new ForbiddenError();

  if (patch.url !== undefined && patch.url && !/^https?:\/\//i.test(patch.url)) {
    throw new AppError("链接要以 http:// 或 https:// 开头");
  }

  const [updated] = await db
    .update(projectEntries)
    .set({
      ...(patch.title !== undefined && { title: patch.title.trim() }),
      ...(patch.content !== undefined && { content: patch.content?.trim() || null }),
      ...(patch.url !== undefined && { url: patch.url?.trim() || null }),
      updatedAt: sql`now()`,
    })
    .where(eq(projectEntries.id, entryId))
    .returning();
  return updated;
}

export async function deleteEntry(actorId: string, entryId: string) {
  const [row] = await db.select().from(projectEntries).where(eq(projectEntries.id, entryId));
  if (!row) throw new AppError("这条记录不存在");

  const access = await getProjectForUser(actorId, row.projectId);
  if (!access) throw new ForbiddenError();
  if (row.authorId !== actorId && access.role !== "admin") throw new ForbiddenError();

  await db.delete(projectEntries).where(eq(projectEntries.id, entryId));
  await recordEvent(db, {
    projectId: row.projectId,
    actorId,
    type: "entry_deleted",
    taskId: row.taskId,
    summary: describe.entryDeleted(ENTRY_LABEL[row.type], row.title),
    payload: { title: row.title, entryType: row.type },
  });
}

/** 档案概览：各类型各有几条，供页面显示与导出用 */
export async function countEntries(projectId: string): Promise<Record<EntryType, number>> {
  const rows = await db
    .select({ type: projectEntries.type, count: sql<number>`count(*)::int` })
    .from(projectEntries)
    .where(eq(projectEntries.projectId, projectId))
    .groupBy(projectEntries.type);

  const out: Record<EntryType, number> = { feedback: 0, doc: 0, deliverable: 0 };
  for (const r of rows) out[r.type] = r.count;
  return out;
}
