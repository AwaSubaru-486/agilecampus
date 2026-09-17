import { and, asc, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  messages,
  tasks,
  users,
  type ConversationVisibility,
} from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { ForbiddenError, AppError } from "@/lib/errors";

export type ToolTraceEntry = { toolName: string; input: unknown; output: unknown };

export type ConversationListItem = {
  id: string;
  title: string | null;
  visibility: ConversationVisibility;
  taskId: string | null;
  taskTitle: string | null;
  parentConversationId: string | null;
  forkedFromMessageId: string | null;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
};

async function assertTaskBelongsToProject(taskId: string, projectId: string) {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!task) throw new AppError("关联任务不属于当前项目");
}

export async function createConversation(
  actorId: string,
  projectId: string,
  input: {
    title?: string;
    visibility?: ConversationVisibility;
    taskId?: string | null;
  } = {},
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (input.taskId) await assertTaskBelongsToProject(input.taskId, projectId);

  const [created] = await db
    .insert(conversations)
    .values({
      projectId,
      createdById: actorId,
      title: input.title?.trim() || "新的 AI 协作会话",
      visibility: input.visibility ?? "project",
      taskId: input.taskId || null,
    })
    .returning();
  return created;
}

export async function listProjectConversations(
  actorId: string,
  projectId: string,
): Promise<ConversationListItem[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      visibility: conversations.visibility,
      taskId: conversations.taskId,
      taskTitle: tasks.title,
      parentConversationId: conversations.parentConversationId,
      forkedFromMessageId: conversations.forkedFromMessageId,
      createdById: conversations.createdById,
      createdByName: users.name,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(users, eq(conversations.createdById, users.id))
    .leftJoin(tasks, eq(conversations.taskId, tasks.id))
    .where(
      and(
        eq(conversations.projectId, projectId),
        or(eq(conversations.visibility, "project"), eq(conversations.createdById, actorId)),
      ),
    )
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
}

export async function getConversationForUser(actorId: string, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new AppError("会话不存在");

  const access = await getProjectForUser(actorId, conversation.projectId);
  if (!access) throw new ForbiddenError();
  if (conversation.visibility === "private" && conversation.createdById !== actorId) {
    throw new ForbiddenError();
  }
  return conversation;
}

// 兼容旧入口：没有显式会话 id 时，复用本人最近的会话；没有则新建。
export async function getOrCreateConversation(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.createdById, actorId)))
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt))
    .limit(1);
  return existing ?? createConversation(actorId, projectId);
}

export async function resolveConversation(
  actorId: string,
  projectId: string,
  conversationId?: string,
) {
  if (!conversationId) return getOrCreateConversation(actorId, projectId);
  const conversation = await getConversationForUser(actorId, conversationId);
  if (conversation.projectId !== projectId) throw new ForbiddenError();
  return conversation;
}

export async function updateConversation(
  actorId: string,
  conversationId: string,
  patch: { title?: string; visibility?: ConversationVisibility; taskId?: string | null },
) {
  const conversation = await getConversationForUser(actorId, conversationId);
  if (conversation.createdById !== actorId) {
    throw new ForbiddenError("只有会话创建者可以修改会话设置");
  }
  if (patch.taskId) await assertTaskBelongsToProject(patch.taskId, conversation.projectId);

  const [updated] = await db
    .update(conversations)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() || "未命名会话" } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning();
  return updated;
}

export async function persistTurn(
  conversationId: string,
  userText: string,
  assistantText: string,
  toolTrace: ToolTraceEntry[],
  authorId?: string,
) {
  return db.transaction(async (tx) => {
    const [lastMessage] = await tx
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);
    const now = Date.now();
    const userCreatedAt = new Date(
      lastMessage ? Math.max(now, lastMessage.createdAt.getTime() + 1) : now,
    );
    const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
    const inserted = await tx
      .insert(messages)
      .values([
        {
          conversationId,
          role: "user" as const,
          content: userText,
          authorId,
          createdAt: userCreatedAt,
        },
        {
          conversationId,
          role: "assistant" as const,
          content: assistantText,
          toolCalls: toolTrace.length > 0 ? toolTrace : null,
          createdAt: assistantCreatedAt,
        },
      ])
      .returning();
    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return { userMessage: inserted[0], assistantMessage: inserted[1] };
  });
}

export async function listConversationMessages(actorId: string, conversationId: string) {
  await getConversationForUser(actorId, conversationId);
  return db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      role: messages.role,
      content: messages.content,
      toolCalls: messages.toolCalls,
      authorId: messages.authorId,
      authorName: users.name,
      sourceMessageId: messages.sourceMessageId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .leftJoin(users, eq(messages.authorId, users.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
}

export async function forkConversation(
  actorId: string,
  sourceConversationId: string,
  throughMessageId: string,
  input: { title?: string; visibility?: ConversationVisibility } = {},
) {
  const source = await getConversationForUser(actorId, sourceConversationId);
  const sourceMessages = await listConversationMessages(actorId, sourceConversationId);
  const boundaryIndex = sourceMessages.findIndex((message) => message.id === throughMessageId);
  if (boundaryIndex < 0) throw new AppError("分支起点不属于当前会话");
  if (sourceMessages[boundaryIndex]?.role !== "assistant") {
    throw new AppError("请从一条已经完成的 AI 回复创建分支");
  }

  const inherited = sourceMessages.slice(0, boundaryIndex + 1);
  const title = input.title?.trim() || `分支 · ${source.title || "AI 协作会话"}`;

  return db.transaction(async (tx) => {
    const [target] = await tx
      .insert(conversations)
      .values({
        projectId: source.projectId,
        createdById: actorId,
        taskId: source.taskId,
        parentConversationId: source.id,
        forkedFromMessageId: throughMessageId,
        visibility: input.visibility ?? "project",
        title,
      })
      .returning();

    if (inherited.length > 0) {
      await tx.insert(messages).values(
        inherited.map((message) => ({
          conversationId: target.id,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls,
          authorId: message.authorId,
          sourceMessageId: message.id,
          createdAt: message.createdAt,
        })),
      );
    }
    return target;
  });
}
