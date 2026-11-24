import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projectMemories,
  tasks,
  users,
  type MemoryCategory,
  type MemoryStatus,
} from "@/db/schema";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { getProjectForUser } from "./project";

export type CreateMemoryInput = {
  taskId?: string | null;
  category: MemoryCategory;
  title: string;
  content: string;
  codeRefSha?: string | null;
};

export type ListMemoriesFilter = {
  taskId?: string;
  status?: MemoryStatus;
  category?: MemoryCategory;
};

/** B05: 沉淀有效项目记忆（约束、架构决策、已验证经验、废弃方案） */
export async function createProjectMemory(
  actorId: string,
  projectId: string,
  input: CreateMemoryInput,
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  if (!input.title || input.title.trim().length === 0) {
    throw new AppError("记忆标题不能为空");
  }
  if (!input.content || input.content.trim().length === 0) {
    throw new AppError("记忆内容不能为空");
  }

  if (input.taskId) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, projectId)));
    if (!task) throw new NotFoundError("指定任务不存在或不属于该项目");
  }

  // 教师或管理员创建自动视为已确认，学生创建需等待确认
  const autoConfirmed = access.role === "admin" || access.role === "teacher";

  const [memory] = await db
    .insert(projectMemories)
    .values({
      projectId,
      taskId: input.taskId ?? null,
      creatorId: actorId,
      confirmedById: autoConfirmed ? actorId : null,
      category: input.category,
      title: input.title.trim(),
      content: input.content.trim(),
      status: "active",
      codeRefSha: input.codeRefSha?.trim() || null,
    })
    .returning();

  return memory;
}

/** B05: 查询项目的有效记忆列表（支持按任务、分类与状态筛选） */
export async function listProjectMemories(
  actorId: string,
  projectId: string,
  filter: ListMemoriesFilter = {},
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const conditions = [
    eq(projectMemories.projectId, projectId),
    filter.taskId ? eq(projectMemories.taskId, filter.taskId) : undefined,
    filter.status ? eq(projectMemories.status, filter.status) : undefined,
    filter.category ? eq(projectMemories.category, filter.category) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: projectMemories.id,
      projectId: projectMemories.projectId,
      taskId: projectMemories.taskId,
      taskTitle: tasks.title,
      creatorId: projectMemories.creatorId,
      creatorName: users.name,
      confirmedById: projectMemories.confirmedById,
      category: projectMemories.category,
      title: projectMemories.title,
      content: projectMemories.content,
      status: projectMemories.status,
      supersededById: projectMemories.supersededById,
      codeRefSha: projectMemories.codeRefSha,
      createdAt: projectMemories.createdAt,
      updatedAt: projectMemories.updatedAt,
    })
    .from(projectMemories)
    .leftJoin(users, eq(projectMemories.creatorId, users.id))
    .leftJoin(tasks, eq(projectMemories.taskId, tasks.id))
    .where(and(...conditions))
    .orderBy(
      sql`CASE ${projectMemories.status} WHEN 'active' THEN 1 WHEN 'needs_review' THEN 2 ELSE 3 END`,
      desc(projectMemories.createdAt),
    );

  return rows;
}

/** B05: 标记记忆状态（例如代码变更后标记需复核，或有新结论时标记已替代） */
export async function updateProjectMemoryStatus(
  actorId: string,
  memoryId: string,
  status: MemoryStatus,
  supersededById?: string,
) {
  const [memory] = await db
    .select()
    .from(projectMemories)
    .where(eq(projectMemories.id, memoryId));

  if (!memory) throw new NotFoundError("项目记忆不存在");

  const access = await getProjectForUser(actorId, memory.projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const [updated] = await db
    .update(projectMemories)
    .set({
      status,
      supersededById: supersededById ?? memory.supersededById,
      updatedAt: new Date(),
    })
    .where(eq(projectMemories.id, memoryId))
    .returning();

  return updated;
}
