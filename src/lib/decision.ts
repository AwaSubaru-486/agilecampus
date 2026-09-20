import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  contextPackItems,
  contextPacks,
  decisionOptions,
  decisions,
  messages,
  milestones,
  projectEntries,
  tasks,
  users,
  type DecisionStatus,
} from "@/db/schema";
import { AppError, ForbiddenError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";
import { recordEvent } from "@/lib/activity";

export type DecisionEvidenceRefType = "message" | "entry" | "task" | "context_item";

export type DecisionEvidenceRef = {
  type: DecisionEvidenceRefType;
  id: string;
};

export type DecisionOptionInput = {
  label: string;
  description?: string;
  benefits?: string[];
  risks?: string[];
  evidenceRefs?: DecisionEvidenceRef[];
};

export type CreateDecisionInput = {
  title: string;
  question: string;
  taskId?: string | null;
  milestoneId?: string | null;
  options: DecisionOptionInput[];
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
};

function listValue(values: string[] | undefined, label: string) {
  if (!values) return null;
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length > 12) throw new AppError(`${label}最多 12 条`);
  if (normalized.some((value) => value.length > 500)) throw new AppError(`${label}每条最多 500 个字`);
  return normalized;
}

const EVIDENCE_REF_TYPES: DecisionEvidenceRefType[] = ["message", "entry", "task", "context_item"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isDecisionEvidenceRef(value: unknown): value is DecisionEvidenceRef {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    EVIDENCE_REF_TYPES.includes((value as DecisionEvidenceRef).type) &&
    typeof (value as DecisionEvidenceRef).id === "string" &&
    UUID_PATTERN.test((value as DecisionEvidenceRef).id)
  );
}

function normalizeEvidenceRefs(refs: DecisionEvidenceRef[] | undefined) {
  if (!refs) return null;
  if (refs.length > 12) throw new AppError("依据引用最多 12 条");
  const seen = new Set<string>();
  return refs.map((ref) => {
    if (!isDecisionEvidenceRef(ref)) {
      throw new AppError("依据引用必须是有效的来源类型和 ID");
    }
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) throw new AppError("依据引用不能重复");
    seen.add(key);
    return { type: ref.type, id: ref.id };
  });
}

async function assertEvidenceRefsAccess(
  actorId: string,
  projectId: string,
  refs: DecisionEvidenceRef[],
) {
  const byType = new Map<DecisionEvidenceRefType, string[]>();
  for (const ref of refs) byType.set(ref.type, [...(byType.get(ref.type) ?? []), ref.id]);

  if (byType.has("message")) {
    const rows = await db
      .select({ id: messages.id, createdById: conversations.createdById, visibility: conversations.visibility })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.projectId, projectId), inArray(messages.id, byType.get("message")!)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of byType.get("message")!) {
      const row = byId.get(id);
      if (!row) throw new AppError("依据消息不属于当前项目");
      if (row.visibility === "private" && row.createdById !== actorId) {
        throw new ForbiddenError("不能引用无权查看的私人消息");
      }
    }
  }

  if (byType.has("entry")) {
    const rows = await db
      .select({ id: projectEntries.id })
      .from(projectEntries)
      .where(and(eq(projectEntries.projectId, projectId), inArray(projectEntries.id, byType.get("entry")!)));
    if (rows.length !== byType.get("entry")!.length) throw new AppError("依据档案不属于当前项目");
  }

  if (byType.has("task")) {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, byType.get("task")!)));
    if (rows.length !== byType.get("task")!.length) throw new AppError("依据任务不属于当前项目");
  }

  if (byType.has("context_item")) {
    const rows = await db
      .select({ id: contextPackItems.id })
      .from(contextPackItems)
      .innerJoin(contextPacks, eq(contextPackItems.packId, contextPacks.id))
      .where(and(eq(contextPacks.projectId, projectId), inArray(contextPackItems.id, byType.get("context_item")!)));
    if (rows.length !== byType.get("context_item")!.length) throw new AppError("依据上下文不属于当前项目");
  }
}

export async function sanitizeEvidenceRefsForViewer(
  actorId: string,
  projectId: string,
  refs: unknown,
  opts: { redactPrivateSources?: boolean } = {},
): Promise<DecisionEvidenceRef[]> {
  if (!Array.isArray(refs)) return [];
  const normalized = refs.filter(isDecisionEvidenceRef);
  if (normalized.length === 0) return [];

  const byType = new Map<DecisionEvidenceRefType, string[]>();
  for (const ref of normalized) byType.set(ref.type, [...(byType.get(ref.type) ?? []), ref.id]);
  const allowed = new Set<string>();

  for (const type of ["entry", "task", "context_item"] as const) {
    const ids = byType.get(type);
    if (!ids?.length) continue;
    if (type === "entry") {
      const rows = await db
        .select({ id: projectEntries.id })
        .from(projectEntries)
        .where(and(eq(projectEntries.projectId, projectId), inArray(projectEntries.id, ids)));
      rows.forEach((row) => allowed.add(`entry:${row.id}`));
    } else if (type === "task") {
      const rows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids)));
      rows.forEach((row) => allowed.add(`task:${row.id}`));
    } else {
      const rows = await db
        .select({ id: contextPackItems.id })
        .from(contextPackItems)
        .innerJoin(contextPacks, eq(contextPackItems.packId, contextPacks.id))
        .where(and(eq(contextPacks.projectId, projectId), inArray(contextPackItems.id, ids)));
      rows.forEach((row) => allowed.add(`context_item:${row.id}`));
    }
  }

  const messageIds = byType.get("message");
  if (messageIds?.length) {
    const rows = await db
      .select({ id: messages.id, createdById: conversations.createdById, visibility: conversations.visibility })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.projectId, projectId), inArray(messages.id, messageIds)));
    for (const row of rows) {
      const visible =
        row.visibility === "project" ||
        (!opts.redactPrivateSources && row.visibility === "private" && row.createdById === actorId);
      if (visible) allowed.add(`message:${row.id}`);
    }
  }

  return normalized.filter((ref) => allowed.has(`${ref.type}:${ref.id}`));
}

function normalizeOption(input: DecisionOptionInput, position: number) {
  const label = input.label.trim();
  if (!label) throw new AppError("决策选项需要名称");
  if (label.length > 160) throw new AppError("决策选项名称最多 160 个字");
  const description = input.description?.trim() || null;
  if (description && description.length > 2_000) throw new AppError("决策选项说明最多 2000 个字");
  return {
    label,
    description,
    benefits: listValue(input.benefits, "收益"),
    risks: listValue(input.risks, "风险"),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
    position,
  };
}

async function assertProjectRelation(projectId: string, taskId?: string | null, milestoneId?: string | null) {
  if (taskId) {
    const [task] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!task || task.projectId !== projectId) throw new AppError("关联任务不属于当前项目");
  }
  if (milestoneId) {
    const [milestone] = await db
      .select({ projectId: milestones.projectId })
      .from(milestones)
      .where(eq(milestones.id, milestoneId));
    if (!milestone || milestone.projectId !== projectId) throw new AppError("关联里程碑不属于当前项目");
  }
}

async function assertSourceAccess(
  actorId: string,
  projectId: string,
  sourceConversationId?: string | null,
  sourceMessageId?: string | null,
) {
  if (!sourceConversationId && sourceMessageId) throw new AppError("来源消息必须关联来源会话");
  if (!sourceConversationId) return;

  const [conversation] = await db
    .select({
      id: conversations.id,
      projectId: conversations.projectId,
      createdById: conversations.createdById,
      visibility: conversations.visibility,
    })
    .from(conversations)
    .where(eq(conversations.id, sourceConversationId));
  if (!conversation || conversation.projectId !== projectId) throw new AppError("来源会话不属于当前项目");
  if (conversation.visibility === "private" && conversation.createdById !== actorId) {
    throw new ForbiddenError("不能引用无权查看的私人会话");
  }
  if (sourceMessageId) {
    const [message] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, sourceMessageId), eq(messages.conversationId, sourceConversationId)));
    if (!message) throw new AppError("来源消息不属于来源会话");
  }
}

async function requireHumanDecisionMaker(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const [actor] = await db.select({ kind: users.kind }).from(users).where(eq(users.id, actorId));
  if (!actor || actor.kind !== "human") throw new ForbiddenError("AI 只能提出决策，不能确认决策");
  return access;
}

export async function createDecision(actorId: string, projectId: string, input: CreateDecisionInput) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const title = input.title.trim();
  const question = input.question.trim();
  if (!title) throw new AppError("决策需要一个标题");
  if (!question) throw new AppError("决策需要说明要回答的问题");
  if (title.length > 240) throw new AppError("决策标题最多 240 个字");
  if (question.length > 2_000) throw new AppError("决策问题最多 2000 个字");
  if (input.options.length === 0) throw new AppError("至少提供一个决策选项");
  if (input.options.length > 8) throw new AppError("决策选项最多 8 个");
  await assertProjectRelation(projectId, input.taskId, input.milestoneId);
  await assertSourceAccess(actorId, projectId, input.sourceConversationId, input.sourceMessageId);

  const normalizedOptions = input.options.map((option, index) => normalizeOption(option, index));
  await assertEvidenceRefsAccess(
    actorId,
    projectId,
    normalizedOptions.flatMap((option) => option.evidenceRefs ?? []),
  );
  return db.transaction(async (tx) => {
    const [decision] = await tx
      .insert(decisions)
      .values({
        projectId,
        taskId: input.taskId ?? null,
        milestoneId: input.milestoneId ?? null,
        title,
        question,
        status: "proposed",
        proposedById: actorId,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
      })
      .returning();
    const options = await tx
      .insert(decisionOptions)
      .values(normalizedOptions.map((option) => ({ ...option, decisionId: decision.id })))
      .returning();
    await recordEvent(tx, {
      projectId,
      actorId,
      type: "decision_created",
      taskId: input.taskId ?? null,
      summary: `提出决策「${title}」`,
      payload: { decisionId: decision.id, title, optionCount: options.length },
    });
    return { ...decision, options };
  });
}

export async function listProjectDecisions(
  actorId: string,
  projectId: string,
  opts: { redactPrivateSources?: boolean } = {},
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const rows = await db
    .select()
    .from(decisions)
    .where(eq(decisions.projectId, projectId))
    .orderBy(desc(decisions.createdAt));
  if (rows.length === 0) return [];

  const options = await db
    .select()
    .from(decisionOptions)
    .where(inArray(decisionOptions.decisionId, rows.map((row) => row.id)))
    .orderBy(asc(decisionOptions.position));
  const sourceIds = rows.map((row) => row.sourceConversationId).filter((id): id is string => Boolean(id));
  const sourceRows = sourceIds.length
    ? await db
        .select({ id: conversations.id, createdById: conversations.createdById, visibility: conversations.visibility })
        .from(conversations)
        .where(inArray(conversations.id, sourceIds))
    : [];
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const allEvidenceRefs = options.flatMap((option) => (Array.isArray(option.evidenceRefs) ? option.evidenceRefs : []));
  const visibleEvidenceRefs = await sanitizeEvidenceRefsForViewer(actorId, projectId, allEvidenceRefs, {
    redactPrivateSources: opts.redactPrivateSources,
  });
  const visibleKeys = new Set(visibleEvidenceRefs.map((ref) => `${ref.type}:${ref.id}`));
  const sanitizedOptions = options.map((option) => ({
    ...option,
    evidenceRefs: (Array.isArray(option.evidenceRefs) ? option.evidenceRefs : []).filter(
      (ref): ref is DecisionEvidenceRef => isDecisionEvidenceRef(ref) && visibleKeys.has(`${ref.type}:${ref.id}`),
    ),
  }));
  const sanitizedByDecision = new Map<string, typeof sanitizedOptions>();
  for (const option of sanitizedOptions) {
    const list = sanitizedByDecision.get(option.decisionId) ?? [];
    list.push(option);
    sanitizedByDecision.set(option.decisionId, list);
  }

  return rows.map((row) => {
    const source = row.sourceConversationId ? sourceById.get(row.sourceConversationId) : null;
    const canExposeSource =
      !source ||
      source.visibility === "project" ||
      (!opts.redactPrivateSources && source.createdById === actorId);
    return {
      ...row,
      sourceConversationId: canExposeSource ? row.sourceConversationId : null,
      sourceMessageId: canExposeSource ? row.sourceMessageId : null,
      options: sanitizedByDecision.get(row.id) ?? [],
    };
  });
}

export async function resolveDecision(
  actorId: string,
  decisionId: string,
  input: { status: Extract<DecisionStatus, "accepted" | "rejected">; selectedOptionId?: string | null; rationale?: string },
) {
  const [decision] = await db.select().from(decisions).where(eq(decisions.id, decisionId));
  if (!decision) throw new AppError("决策不存在");
  await requireHumanDecisionMaker(actorId, decision.projectId);
  if (decision.status !== "proposed") throw new AppError("只有待确认的决策可以确认或否决");
  const rationale = input.rationale?.trim() || "";
  if (!rationale) throw new AppError("确认或否决决策必须写明理由");

  let selectedOptionId: string | null = null;
  if (input.status === "accepted") {
    if (!input.selectedOptionId) throw new AppError("接受决策时必须选择一个选项");
    const [option] = await db
      .select({ id: decisionOptions.id })
      .from(decisionOptions)
      .where(and(eq(decisionOptions.id, input.selectedOptionId), eq(decisionOptions.decisionId, decisionId)));
    if (!option) throw new AppError("所选方案不属于该决策");
    selectedOptionId = option.id;
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(decisions)
      .set({
        status: input.status,
        selectedOptionId,
        rationale,
        decidedById: actorId,
        decidedAt: new Date(),
      })
      .where(eq(decisions.id, decisionId))
      .returning();
    await recordEvent(tx, {
      projectId: decision.projectId,
      actorId,
      type: "decision_status_changed",
      taskId: decision.taskId,
      summary: `${input.status === "accepted" ? "接受" : "否决"}决策「${decision.title}」`,
      payload: { decisionId, status: input.status, selectedOptionId, rationale },
    });
    return updated;
  });
}

export async function supersedeDecision(actorId: string, decisionId: string, replacementId: string) {
  if (decisionId === replacementId) throw new AppError("决策不能替代自己");
  const [decision] = await db.select().from(decisions).where(eq(decisions.id, decisionId));
  const [replacement] = await db.select().from(decisions).where(eq(decisions.id, replacementId));
  if (!decision || !replacement) throw new AppError("决策不存在");
  if (decision.projectId !== replacement.projectId) throw new AppError("只能替代同一项目的决策");
  await requireHumanDecisionMaker(actorId, decision.projectId);
  if (decision.status === "superseded") throw new AppError("该决策已经被替代");

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(decisions)
      .set({ status: "superseded", supersededById: replacement.id, decidedById: actorId, decidedAt: new Date() })
      .where(eq(decisions.id, decision.id))
      .returning();
    await recordEvent(tx, {
      projectId: decision.projectId,
      actorId,
      type: "decision_superseded",
      taskId: decision.taskId,
      summary: `决策「${decision.title}」被新决策替代`,
      payload: { decisionId: decision.id, supersededById: replacement.id },
    });
    return updated;
  });
}
