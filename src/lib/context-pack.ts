import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  blockers,
  contextPackItems,
  contextPacks,
  conversations,
  decisionOptions,
  decisions,
  messages,
  milestones,
  projectEntries,
  projects,
  tasks,
  type ContextSourceType,
} from "@/db/schema";
import { getConversationForUser } from "@/lib/agent/conversation";
import { sanitizeEvidenceRefsForViewer } from "@/lib/decision";
import { AppError, ForbiddenError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";

export const MAX_CONTEXT_PACK_ITEMS = 20;
export const MAX_CONTEXT_PACK_CHARS = 24_000;

export type ContextSourceDescriptor = {
  sourceType: ContextSourceType;
  sourceId?: string | null;
  label?: string;
  included?: boolean;
  /** 仅 manual 来源使用；其他类型一律从数据库生成快照。 */
  snapshot?: Record<string, unknown>;
};

type ResolvedContextItem = {
  sourceType: ContextSourceType;
  sourceId: string | null;
  label: string;
  snapshot: Record<string, unknown>;
  sourceUpdatedAt: Date | null;
  included: boolean;
};

export type ContextPackPreviewItem = ResolvedContextItem & {
  textSize: number;
};

export type ContextPackPreview = {
  items: ContextPackPreviewItem[];
  omitted: number;
  totalTextLength: number;
};

export type ContextPackView = {
  pack: typeof contextPacks.$inferSelect;
  items: Array<typeof contextPackItems.$inferSelect & { stale: boolean }>;
  stale: boolean;
};

function asSnapshot(value: Record<string, unknown>) {
  return value;
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function jsonSize(snapshot: Record<string, unknown>) {
  return JSON.stringify(snapshot).length;
}

function normalizeContextItems(items: ResolvedContextItem[]): ContextPackPreview {
  const preview: ContextPackPreviewItem[] = [];
  let omitted = Math.max(0, items.length - MAX_CONTEXT_PACK_ITEMS);
  let totalTextLength = 0;

  for (const item of items.slice(0, MAX_CONTEXT_PACK_ITEMS)) {
    const textSize = jsonSize(item.snapshot);
    if (item.included && totalTextLength + textSize > MAX_CONTEXT_PACK_CHARS) {
      omitted += 1;
      preview.push({ ...item, included: false, textSize });
      continue;
    }
    if (item.included) totalTextLength += textSize;
    preview.push({ ...item, textSize });
  }

  return { items: preview, omitted, totalTextLength };
}

async function resolveSource(
  actorId: string,
  projectId: string,
  descriptor: ContextSourceDescriptor,
): Promise<ResolvedContextItem> {
  const sourceId = descriptor.sourceId ?? null;
  const included = descriptor.included !== false;

  if (descriptor.sourceType === "manual") {
    if (sourceId) throw new AppError("手工上下文不能带 sourceId");
    const snapshot = descriptor.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new AppError("手工上下文需要一个对象快照");
    }
    return {
      sourceType: "manual",
      sourceId: null,
      label: descriptor.label?.trim() || "手工补充",
      snapshot: asSnapshot(snapshot),
      sourceUpdatedAt: null,
      included,
    };
  }

  if (!sourceId && descriptor.sourceType !== "project") {
    throw new AppError(`${descriptor.sourceType} 来源缺少 sourceId`);
  }

  if (descriptor.sourceType === "project") {
    const access = await getProjectForUser(actorId, projectId);
    if (!access) throw new ForbiddenError();
    return {
      sourceType: "project",
      sourceId: access.project.id,
      label: descriptor.label?.trim() || `项目：${access.project.name}`,
      snapshot: {
        name: access.project.name,
        description: access.project.description,
        status: access.project.status,
        startDate: access.project.startDate,
        endDate: access.project.endDate,
      },
      sourceUpdatedAt: access.project.createdAt,
      included,
    };
  }

  if (descriptor.sourceType === "milestone") {
    const [row] = await db
      .select()
      .from(milestones)
      .where(and(eq(milestones.id, sourceId!), eq(milestones.projectId, projectId)));
    if (!row) throw new AppError("里程碑不属于当前项目");
    return {
      sourceType: "milestone",
      sourceId: row.id,
      label: descriptor.label?.trim() || `里程碑：${row.title}`,
      snapshot: {
        title: row.title,
        targetDate: row.targetDate,
        status: row.status,
        achievedAt: iso(row.achievedAt),
        autoSummary: row.autoSummary,
      },
      sourceUpdatedAt: row.achievedAt ?? row.createdAt,
      included,
    };
  }

  if (descriptor.sourceType === "task") {
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, sourceId!), eq(tasks.projectId, projectId)));
    if (!row) throw new AppError("任务不属于当前项目");
    return {
      sourceType: "task",
      sourceId: row.id,
      label: descriptor.label?.trim() || `任务：${row.title}`,
      snapshot: {
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        dueDate: row.dueDate,
        commitmentNote: row.commitmentNote,
        completionNote: row.completionNote,
      },
      sourceUpdatedAt: row.updatedAt,
      included,
    };
  }

  if (descriptor.sourceType === "blocker") {
    const [row] = await db
      .select()
      .from(blockers)
      .where(and(eq(blockers.id, sourceId!), eq(blockers.projectId, projectId)));
    if (!row) throw new AppError("阻塞不属于当前项目");
    return {
      sourceType: "blocker",
      sourceId: row.id,
      label: descriptor.label?.trim() || "项目阻塞",
      snapshot: {
        reason: row.reason,
        detail: row.detail,
        helpNeeded: row.helpNeeded,
        status: row.status,
        resolutionNote: row.resolutionNote,
      },
      sourceUpdatedAt: row.resolvedAt ?? row.createdAt,
      included,
    };
  }

  if (descriptor.sourceType === "entry") {
    const [row] = await db
      .select()
      .from(projectEntries)
      .where(and(eq(projectEntries.id, sourceId!), eq(projectEntries.projectId, projectId)));
    if (!row) throw new AppError("项目档案不属于当前项目");
    return {
      sourceType: "entry",
      sourceId: row.id,
      label: descriptor.label?.trim() || `档案：${row.title}`,
      snapshot: {
        type: row.type,
        title: row.title,
        content: row.content,
        url: row.url,
        taskId: row.taskId,
      },
      sourceUpdatedAt: row.updatedAt,
      included,
    };
  }

  if (descriptor.sourceType === "decision") {
    const [row] = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.id, sourceId!), eq(decisions.projectId, projectId)));
    if (!row) throw new AppError("决策记录不属于当前项目");
    const rawOptions = await db
      .select({
        label: decisionOptions.label,
        description: decisionOptions.description,
        benefits: decisionOptions.benefits,
        risks: decisionOptions.risks,
        evidenceRefs: decisionOptions.evidenceRefs,
        position: decisionOptions.position,
      })
      .from(decisionOptions)
      .where(eq(decisionOptions.decisionId, row.id))
      .orderBy(asc(decisionOptions.position));
    // Context Pack 可能被整个项目共享；私人消息依据即使创建者本人可见，也不能随快照扩散。
    const options = await Promise.all(
      rawOptions.map(async (option) => ({
        ...option,
        evidenceRefs: await sanitizeEvidenceRefsForViewer(actorId, projectId, option.evidenceRefs, {
          redactPrivateSources: true,
        }),
      })),
    );
    return {
      sourceType: "decision",
      sourceId: row.id,
      label: descriptor.label?.trim() || `决策：${row.title}`,
      snapshot: {
        title: row.title,
        question: row.question,
        status: row.status,
        selectedOptionId: row.selectedOptionId,
        rationale: row.rationale,
        options,
      },
      sourceUpdatedAt: row.decidedAt ?? row.createdAt,
      included,
    };
  }

  if (descriptor.sourceType === "conversation") {
    const row = await getConversationForUser(actorId, sourceId!);
    if (row.projectId !== projectId) throw new ForbiddenError();
    return {
      sourceType: "conversation",
      sourceId: row.id,
      label: descriptor.label?.trim() || `协作会话：${row.title || "未命名"}`,
      snapshot: {
        title: row.title,
        visibility: row.visibility,
        taskId: row.taskId,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      },
      sourceUpdatedAt: row.updatedAt,
      included,
    };
  }

  if (descriptor.sourceType === "message") {
    const [row] = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        projectId: conversations.projectId,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(messages.id, sourceId!));
    if (!row || row.projectId !== projectId) throw new AppError("消息不属于当前项目");
    await getConversationForUser(actorId, row.conversationId);
    return {
      sourceType: "message",
      sourceId: row.id,
      label: descriptor.label?.trim() || "协作消息",
      snapshot: {
        conversationId: row.conversationId,
        role: row.role,
        content: row.content,
        createdAt: iso(row.createdAt),
      },
      sourceUpdatedAt: row.createdAt,
      included,
    };
  }

  if (descriptor.sourceType === "activity_window") {
    const [row] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.id, sourceId!), eq(activityEvents.projectId, projectId)));
    if (!row) throw new AppError("活动记录不属于当前项目");
    return {
      sourceType: "activity_window",
      sourceId: row.id,
      label: descriptor.label?.trim() || "项目活动",
      snapshot: {
        type: row.type,
        summary: row.summary,
        taskId: row.taskId,
        payload: row.payload,
        createdAt: iso(row.createdAt),
      },
      sourceUpdatedAt: row.createdAt,
      included,
    };
  }

  // 所有非 manual 来源都必须在上面显式处理，避免静默读取任意表。
  throw new AppError(`暂不支持的上下文来源：${descriptor.sourceType}`);
}

export async function buildContextPackPreview(
  actorId: string,
  projectId: string,
  descriptors: ContextSourceDescriptor[],
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (descriptors.length === 0) throw new AppError("至少选择一条上下文来源");
  if (descriptors.length > 100) throw new AppError("一次最多预览 100 条来源");

  const resolved = [] as ResolvedContextItem[];
  for (const descriptor of descriptors) {
    resolved.push(await resolveSource(actorId, projectId, descriptor));
  }
  return normalizeContextItems(resolved);
}

async function validatePackTarget(
  actorId: string,
  projectId: string,
  conversationId?: string | null,
  taskId?: string | null,
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (conversationId) {
    const conversation = await getConversationForUser(actorId, conversationId);
    if (conversation.projectId !== projectId) throw new ForbiddenError();
  }
  if (taskId) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
    if (!task) throw new AppError("关联任务不属于当前项目");
  }
}

export async function createContextPack(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    summary?: string | null;
    conversationId?: string | null;
    taskId?: string | null;
    sources: ContextSourceDescriptor[];
    status?: "draft" | "frozen";
  },
) {
  const title = input.title.trim();
  if (!title) throw new AppError("上下文包需要一个标题");
  await validatePackTarget(actorId, projectId, input.conversationId, input.taskId);
  const preview = await buildContextPackPreview(actorId, projectId, input.sources);
  const status = input.status ?? "draft";

  return db.transaction(async (tx) => {
    const [pack] = await tx
      .insert(contextPacks)
      .values({
        projectId,
        conversationId: input.conversationId ?? null,
        taskId: input.taskId ?? null,
        createdById: actorId,
        title,
        summary: input.summary?.trim() || null,
        status,
        frozenAt: status === "frozen" ? new Date() : null,
      })
      .returning();
    if (preview.items.length) {
      await tx.insert(contextPackItems).values(
        preview.items.map((item, position) => ({
          packId: pack.id,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          label: item.label,
          snapshot: item.snapshot,
          sourceUpdatedAt: item.sourceUpdatedAt,
          included: item.included,
          position,
        })),
      );
    }
    return { pack, preview };
  });
}

async function currentSourceUpdatedAt(actorId: string, item: typeof contextPackItems.$inferSelect) {
  if (!item.sourceId) return item.sourceUpdatedAt;
  if (item.sourceType === "conversation") {
    const row = await getConversationForUser(actorId, item.sourceId);
    return row.updatedAt;
  }
  if (item.sourceType === "message") {
    const [row] = await db
      .select({ createdAt: messages.createdAt, conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.id, item.sourceId));
    if (!row) return null;
    await getConversationForUser(actorId, row.conversationId);
    return row.createdAt;
  }
  if (item.sourceType === "task") {
    const [row] = await db.select({ updatedAt: tasks.updatedAt }).from(tasks).where(eq(tasks.id, item.sourceId));
    return row?.updatedAt ?? null;
  }
  if (item.sourceType === "entry") {
    const [row] = await db.select({ updatedAt: projectEntries.updatedAt }).from(projectEntries).where(eq(projectEntries.id, item.sourceId));
    return row?.updatedAt ?? null;
  }
  if (item.sourceType === "blocker") {
    const [row] = await db
      .select({ resolvedAt: blockers.resolvedAt, createdAt: blockers.createdAt })
      .from(blockers)
      .where(eq(blockers.id, item.sourceId));
    return row ? row.resolvedAt ?? row.createdAt : null;
  }
  if (item.sourceType === "milestone") {
    const [row] = await db
      .select({ achievedAt: milestones.achievedAt, createdAt: milestones.createdAt })
      .from(milestones)
      .where(eq(milestones.id, item.sourceId));
    return row ? row.achievedAt ?? row.createdAt : null;
  }
  if (item.sourceType === "activity_window") {
    const [row] = await db
      .select({ createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .where(eq(activityEvents.id, item.sourceId));
    return row?.createdAt ?? null;
  }
  if (item.sourceType === "decision") {
    const [row] = await db
      .select({ createdAt: decisions.createdAt, decidedAt: decisions.decidedAt })
      .from(decisions)
      .where(eq(decisions.id, item.sourceId));
    return row ? row.decidedAt ?? row.createdAt : null;
  }
  if (item.sourceType === "project") {
    const [row] = await db
      .select({ createdAt: projects.createdAt })
      .from(projects)
      .where(eq(projects.id, item.sourceId));
    return row?.createdAt ?? null;
  }
  return item.sourceUpdatedAt;
}

export async function getContextPackForUser(actorId: string, packId: string): Promise<ContextPackView> {
  const [pack] = await db.select().from(contextPacks).where(eq(contextPacks.id, packId));
  if (!pack) throw new AppError("上下文包不存在");
  const access = await getProjectForUser(actorId, pack.projectId);
  if (!access) throw new ForbiddenError();
  if (pack.conversationId) await getConversationForUser(actorId, pack.conversationId);

  const rawItems = await db
    .select()
    .from(contextPackItems)
    .where(eq(contextPackItems.packId, pack.id))
    .orderBy(asc(contextPackItems.position));
  const items = [] as ContextPackView["items"];
  for (const item of rawItems) {
    const current = await currentSourceUpdatedAt(actorId, item);
    items.push({
      ...item,
      stale:
        Boolean(item.sourceUpdatedAt && current && current.getTime() > item.sourceUpdatedAt.getTime()) ||
        Boolean(item.sourceUpdatedAt && !current),
    });
  }
  return { pack, items, stale: items.some((item) => item.stale) };
}

export async function freezeContextPack(actorId: string, packId: string) {
  const [pack] = await db.select().from(contextPacks).where(eq(contextPacks.id, packId));
  if (!pack) throw new AppError("上下文包不存在");
  const access = await getProjectForUser(actorId, pack.projectId);
  if (!access) throw new ForbiddenError();
  if (pack.createdById !== actorId) throw new ForbiddenError("只有创建者可以冻结上下文包");
  if (pack.status !== "draft") throw new AppError("只有草稿上下文包可以冻结");

  const [frozen] = await db
    .update(contextPacks)
    .set({ status: "frozen", frozenAt: new Date() })
    .where(and(eq(contextPacks.id, packId), eq(contextPacks.status, "draft")))
    .returning();
  if (!frozen) throw new AppError("上下文包状态已改变，请刷新后重试");
  return frozen;
}

export async function listContextPacks(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return db
    .select({
      id: contextPacks.id,
      projectId: contextPacks.projectId,
      conversationId: contextPacks.conversationId,
      taskId: contextPacks.taskId,
      createdById: contextPacks.createdById,
      title: contextPacks.title,
      status: contextPacks.status,
      summary: contextPacks.summary,
      createdAt: contextPacks.createdAt,
      frozenAt: contextPacks.frozenAt,
    })
    .from(contextPacks)
    .leftJoin(conversations, eq(contextPacks.conversationId, conversations.id))
    .where(
      and(
        eq(contextPacks.projectId, projectId),
        or(
          isNull(contextPacks.conversationId),
          eq(conversations.visibility, "project"),
          eq(conversations.createdById, actorId),
        ),
      ),
    )
    .orderBy(asc(contextPacks.createdAt));
}
