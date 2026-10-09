import { enqueueStageHandoffs } from "./task-notifications";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { db } from "@/db";
import {
  projectBriefs,
  stageIntegrations,
  taskStages,
  taskDeliveries,
  taskTreeDrafts,
  tasks,
  users,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getModelForUser } from "./agent/model";
import { describe, recordEvent } from "./activity";
import { getProjectForUser } from "./project";
import { getTutorialProgress } from "./tutorials/progress";
import { listTeamMembers } from "./team";

const draftTaskSchema = z.object({
  key: z.string().trim().min(1).max(60),
  parentKey: z.string().trim().min(1).max(60).nullable().default(null),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
  assigneeId: z.uuid().nullable().default(null),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  doneCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
});

export const taskTreePayloadSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  stages: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    tasks: z.array(draftTaskSchema).min(1).max(40),
  })).min(1).max(10),
});

export type TaskTreePayload = z.infer<typeof taskTreePayloadSchema>;

async function requireProject(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

async function requireTreeAdmin(actorId: string, projectId: string) {
  const access = await requireProject(actorId, projectId);
  if (access.role !== "admin") throw new ForbiddenError("只有项目负责人可以发布任务树和审核阶段集成");
  return access;
}

async function requireTreeReview(actorId: string, projectId: string) {
  const access = await requireProject(actorId, projectId);
  if (access.role !== "admin" && access.role !== "teacher") throw new ForbiddenError("只有组长或教师可以审核阶段集成");
  return access;
}

function parseModelJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AppError("AI 返回的任务树格式无效，请重新生成");
  }
}

export async function generateTaskTreeDraft(
  actorId: string,
  projectId: string,
  content: string,
  model?: LanguageModel,
) {
  const access = await requireTreeAdmin(actorId, projectId);
  const briefText = content.trim();
  if (briefText.length < 10) throw new AppError("项目说明至少需要 10 个字");
  if (briefText.length > 20_000) throw new AppError("项目说明不能超过 20000 字");

  const [members, existingTasks] = await Promise.all([
    listTeamMembers(access.project.teamId),
    db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(eq(tasks.projectId, projectId)),
  ]);
  const roster = members.filter((member) => member.role !== "teacher").map((member) => ({ id: member.id, name: member.name, role: member.role }));
  const { text } = await generateText({
    model: model ?? await getModelForUser(actorId),
    maxRetries: 0,
    system: `你是敏捷项目任务规划器。把新项目说明转成可人工确认的增量任务树。\n
只输出严格 JSON，不要 Markdown。结构：
{"summary":"说明","stages":[{"title":"阶段名称","tasks":[{"key":"本草案唯一短键","parentKey":null,"title":"任务名","description":"可执行说明","assigneeId":null,"priority":"medium","doneCriteria":["可验证标准"]}]}]}

规则：同一阶段可并行，后续阶段必须等待前一阶段集成审核；父节点只用于分组，叶子任务必须可独立交付；parentKey 只能引用同阶段较早出现的 key；负责人只能使用给定成员 id，无法确定就填 null；不要重复已完成工作，新说明影响既有成果时创建明确的补充或返工任务；总任务不超过 60 个。`,
    prompt: `项目：${access.project.name}\n成员：${JSON.stringify(roster)}\n现有任务：${JSON.stringify(existingTasks)}\n新项目说明：\n${briefText}`,
  });
  const payload = taskTreePayloadSchema.parse(parseModelJson(text));
  validateDraftGraph(payload);

  return persistTaskTreeDraft(actorId,projectId,briefText,payload);
}

/** Same draft/publish pipeline, with an explicitly labelled template for the learner's newly created project. */
export async function generateTutorialTaskTreeDraft(actorId:string,projectId:string,content:string) {
  await requireTreeAdmin(actorId,projectId);
  const progress=await getTutorialProgress(actorId);
  if(progress.journey?.projectId!==projectId) throw new ForbiddenError();
  const briefText=content.trim();
  if(briefText.length<10 || briefText.length>20000) throw new AppError("项目说明需填写 10 至 20000 个字");
  const payload=taskTreePayloadSchema.parse({
    summary:"教学模板：先完成报名表单，再增加成功回执。请按你的目标修订任务、负责人和标准。",
    stages:[
      {title:"第 1 轮：报名表单",tasks:[{key:"signup",parentKey:null,title:"实现报名表单与必填校验",description:`教学练习任务，需求：${briefText.slice(0,1500)}`,assigneeId:actorId,priority:"medium",doneCriteria:["缺少姓名或联系方式时显示字段提示","完整信息可以提交报名"]}]},
      {title:"第 2 轮：报名成功回执",tasks:[{key:"receipt",parentKey:null,title:"增加报名成功回执",description:"第一轮集成通过后，为同学展示报名状态。",assigneeId:actorId,priority:"medium",doneCriteria:["报名成功后可以看到状态回执"]}]},
    ],
  });
  validateDraftGraph(payload);
  return persistTaskTreeDraft(actorId,projectId,briefText,payload);
}
async function persistTaskTreeDraft(actorId:string,projectId:string,briefText:string,payload:TaskTreePayload) {
  return db.transaction(async (tx) => {
    const [brief] = await tx.insert(projectBriefs).values({
      projectId,
      content: briefText,
      createdById: actorId,
    }).returning();
    const [draft] = await tx.insert(taskTreeDrafts).values({
      projectId,
      briefId: brief.id,
      payload,
      createdById: actorId,
    }).returning();
    return { brief, draft: { ...draft, payload } };
  });
}

function validateDraftGraph(payload: TaskTreePayload) {
  let count = 0;
  for (const stage of payload.stages) {
    const seen = new Set<string>();
    for (const task of stage.tasks) {
      count += 1;
      if (seen.has(task.key)) throw new AppError(`任务键重复：${task.key}`);
      if (task.parentKey && !seen.has(task.parentKey)) throw new AppError(`父任务必须先出现：${task.title}`);
      seen.add(task.key);
    }
  }
  if (count > 60) throw new AppError("一次最多生成 60 个任务");
}

export async function publishTaskTreeDraft(actorId: string, draftId: string) {
  const [draft] = await db.select().from(taskTreeDrafts).where(eq(taskTreeDrafts.id, draftId));
  if (!draft) throw new AppError("任务树草案不存在");
  const access = await requireTreeAdmin(actorId, draft.projectId);
  if (draft.status !== "pending") throw new AppError("该草案已经处理");
  const payload = taskTreePayloadSchema.parse(draft.payload);
  validateDraftGraph(payload);

  const members = await listTeamMembers(access.project.teamId);
  const memberIds = new Set(members.filter((member) => member.role !== "teacher").map((member) => member.id));
  for (const stage of payload.stages) for (const task of stage.tasks) {
    if (task.assigneeId && !memberIds.has(task.assigneeId)) throw new AppError(`任务“${task.title}”的负责人已不在团队中或为导师，请重新分配`);
  }

  return db.transaction(async (tx) => {
    const [claimedDraft] = await tx.update(taskTreeDrafts).set({
      status: "published", resolvedById: actorId, resolvedAt: new Date(),
    }).where(and(eq(taskTreeDrafts.id, draftId), eq(taskTreeDrafts.status, "pending"))).returning({ id: taskTreeDrafts.id });
    if (!claimedDraft) throw new AppError("该草案已经处理");
    const [{ highest, unfinished }] = await tx
      .select({ highest: max(taskStages.position), unfinished: sql<number>`count(*) filter (where ${taskStages.status} <> 'completed')::int` })
      .from(taskStages)
      .where(eq(taskStages.projectId, draft.projectId));
    let position = (highest ?? 0) + 1;
    const created = [];
    for (let stageIndex = 0; stageIndex < payload.stages.length; stageIndex += 1) {
      const stageDraft = payload.stages[stageIndex];
      const [stage] = await tx.insert(taskStages).values({
        projectId: draft.projectId,
        sourceBriefId: draft.briefId,
        title: stageDraft.title,
        position: position++,
        status: unfinished === 0 && stageIndex === 0 ? "active" : "locked",
      }).returning();
      const ids = new Map<string, string>();
      const parentKeys = new Set(stageDraft.tasks.flatMap((item) => item.parentKey ? [item.parentKey] : []));
      for (const item of stageDraft.tasks) {
        const [task] = await tx.insert(tasks).values({
          projectId: draft.projectId,
          stageId: stage.id,
          sourceBriefId: draft.briefId,
          isTaskGroup: parentKeys.has(item.key),
          parentTaskId: item.parentKey ? ids.get(item.parentKey) : null,
          createdById: actorId,
          title: item.title,
          description: item.description || null,
          assigneeId: item.assigneeId,
          priority: item.priority,
          doneCriteria: item.doneCriteria,
          sortOrder: Date.now() + ids.size,
        }).returning();
        ids.set(item.key, task.id);
        await recordEvent(tx, {
          projectId: draft.projectId,
          actorId,
          type: "task_created",
          taskId: task.id,
          summary: describe.taskCreated(task.title),
          payload: { title: task.title, status: task.status, assigneeId: task.assigneeId, source: "task_tree" },
        });
      }
      created.push(stage);
    }
    return created;
  });
}

export async function rejectTaskTreeDraft(actorId: string, draftId: string) {
  const [draft] = await db.select().from(taskTreeDrafts).where(eq(taskTreeDrafts.id, draftId));
  if (!draft) throw new AppError("任务树草案不存在");
  await requireTreeAdmin(actorId, draft.projectId);
  await db.update(taskTreeDrafts).set({ status: "rejected", resolvedById: actorId, resolvedAt: new Date() }).where(and(eq(taskTreeDrafts.id, draftId), eq(taskTreeDrafts.status, "pending")));
}

export async function updateTaskTreeDraft(actorId: string, draftId: string, input: unknown) {
  const [draft] = await db.select().from(taskTreeDrafts).where(eq(taskTreeDrafts.id, draftId));
  if (!draft) throw new AppError("任务树草案不存在");
  const access = await requireTreeAdmin(actorId, draft.projectId);
  const payload = taskTreePayloadSchema.parse(input);
  validateDraftGraph(payload);
  const members = await listTeamMembers(access.project.teamId);
  const memberIds = new Set(members.filter((member) => member.role !== "teacher").map((member) => member.id));
  for (const stage of payload.stages) for (const task of stage.tasks) {
    if (task.assigneeId && !memberIds.has(task.assigneeId)) throw new AppError("负责人不是团队成员或为导师，请重新分配");
  }
  const [saved] = await db.update(taskTreeDrafts).set({ payload })
    .where(and(eq(taskTreeDrafts.id, draftId), eq(taskTreeDrafts.status, "pending"))).returning();
  if (!saved) throw new AppError("该草案已经处理，请刷新页面");
  return saved;
}

export async function getTaskTree(actorId: string, projectId: string) {
  await requireProject(actorId, projectId);
  const [stages, rows, drafts, integrations, deliveries] = await Promise.all([
    db.select().from(taskStages).where(eq(taskStages.projectId, projectId)).orderBy(asc(taskStages.position)),
    db.select({
      id: tasks.id, stageId: tasks.stageId, parentTaskId: tasks.parentTaskId, title: tasks.title,
      isTaskGroup: tasks.isTaskGroup,
      description: tasks.description, status: tasks.status, priority: tasks.priority,
      assigneeId: tasks.assigneeId, assigneeName: users.name, doneCriteria: tasks.doneCriteria,
    }).from(tasks).leftJoin(users, eq(tasks.assigneeId, users.id)).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.sortOrder)),
    db.select().from(taskTreeDrafts).where(and(eq(taskTreeDrafts.projectId, projectId), eq(taskTreeDrafts.status, "pending"))).orderBy(desc(taskTreeDrafts.createdAt)),
    db.select().from(stageIntegrations).where(inArray(stageIntegrations.stageId, db.select({ id: taskStages.id }).from(taskStages).where(eq(taskStages.projectId, projectId)))).orderBy(desc(stageIntegrations.createdAt)),
    db.select().from(taskDeliveries).where(inArray(taskDeliveries.taskId, db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)))).orderBy(desc(taskDeliveries.createdAt)),
  ]);
  return { stages, tasks: rows, drafts: drafts.map((draft) => ({ ...draft, payload: taskTreePayloadSchema.parse(draft.payload) })), integrations, deliveries };
}

export async function submitTaskDelivery(actorId: string, taskId: string, input: { branchName: string; headSha?: string; pullRequestUrl?: string; testSummary?: string }) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || !task.stageId) throw new AppError("任务不属于任务树阶段");
  const access = await requireProject(actorId, task.projectId);
  if (access.role === "teacher") throw new ForbiddenError("导师不能登记执行成果");
  if (task.isTaskGroup) throw new AppError("请在执行任务上登记交付分支");
  if (access.role !== "admin" && task.assigneeId !== actorId) throw new ForbiddenError("只有任务负责人可以登记交付分支");
  const [stage] = await db.select({ status: taskStages.status }).from(taskStages).where(eq(taskStages.id, task.stageId));
  if (!stage || stage.status !== "active") throw new AppError("当前阶段不能登记交付分支");
  const branchName = input.branchName.trim();
  if (!branchName) throw new AppError("请填写任务分支");
  if (input.pullRequestUrl && !/^https?:\/\//i.test(input.pullRequestUrl.trim())) throw new AppError("PR 地址格式不正确");
  const [delivery] = await db.insert(taskDeliveries).values({
    taskId, branchName, headSha: input.headSha?.trim() || null,
    pullRequestUrl: input.pullRequestUrl?.trim() || null,
    testSummary: input.testSummary?.trim() || null, submittedById: actorId,
  }).returning();
  return delivery;
}

export async function submitStageIntegration(actorId: string, stageId: string, input: { branchName: string; headSha?: string; testSummary?: string }) {
  const [stage] = await db.select().from(taskStages).where(eq(taskStages.id, stageId));
  if (!stage) throw new AppError("执行阶段不存在");
  await requireTreeAdmin(actorId, stage.projectId);
  if (stage.status !== "active") throw new AppError("该阶段当前不能提交集成审核");
  const stageTasks = await db.select({ id: tasks.id, parentTaskId: tasks.parentTaskId, status: tasks.status }).from(tasks).where(eq(tasks.stageId, stageId));
  const parentIds = new Set(stageTasks.flatMap((task) => task.parentTaskId ? [task.parentTaskId] : []));
  const unfinished = stageTasks.filter((task) => !parentIds.has(task.id) && task.status !== "done");
  if (unfinished.length) throw new AppError(`还有 ${unfinished.length} 个叶子任务未通过验收`);
  const leafIds = stageTasks.filter((task) => !parentIds.has(task.id)).map((task) => task.id);
  const delivered = leafIds.length ? await db.select({ taskId: taskDeliveries.taskId }).from(taskDeliveries).where(inArray(taskDeliveries.taskId, leafIds)) : [];
  const deliveredIds = new Set(delivered.map((item) => item.taskId));
  const missingDeliveries = leafIds.filter((id) => !deliveredIds.has(id));
  if (missingDeliveries.length) throw new AppError(`还有 ${missingDeliveries.length} 个叶子任务未登记交付分支`);
  const branchName = input.branchName.trim();
  if (!branchName) throw new AppError("请填写集成分支");

  return db.transaction(async (tx) => {
    const [claimedStage] = await tx.update(taskStages).set({
      status: "integrating", integrationBranch: branchName, updatedAt: new Date(),
    }).where(and(eq(taskStages.id, stageId), eq(taskStages.status, "active"))).returning({ id: taskStages.id });
    if (!claimedStage) throw new AppError("该阶段状态已变化，请刷新后重试");
    const [integration] = await tx.insert(stageIntegrations).values({
      stageId, branchName, headSha: input.headSha?.trim() || null,
      testSummary: input.testSummary?.trim() || null, submittedById: actorId,
    }).returning();
    return integration;
  });
}

export async function reviewStageIntegration(actorId: string, integrationId: string, input: { decision: "accept" | "reject"; note?: string }) {
  const [row] = await db.select({ integration: stageIntegrations, stage: taskStages }).from(stageIntegrations).innerJoin(taskStages, eq(stageIntegrations.stageId, taskStages.id)).where(eq(stageIntegrations.id, integrationId));
  if (!row) throw new AppError("集成审核不存在");
  await requireTreeReview(actorId, row.stage.projectId);
  if (row.integration.decision !== "pending" || row.stage.status !== "integrating") throw new AppError("该集成审核已经处理");
  if (row.integration.submittedById === actorId) throw new AppError("不能审核自己提交的阶段集成");
  if (input.decision === "reject" && !input.note?.trim()) throw new AppError("退回时请填写原因");

  return db.transaction(async (tx) => {
    const [resolved] = await tx.update(stageIntegrations).set({ decision: input.decision === "accept" ? "accepted" : "rejected", reviewNote: input.note?.trim() || null, reviewedById: actorId, reviewedAt: new Date() }).where(and(eq(stageIntegrations.id, integrationId), eq(stageIntegrations.decision, "pending"))).returning({ id: stageIntegrations.id });
    if (!resolved) throw new AppError("该集成审核已经处理");
    if (input.decision === "reject") {
      const [reopened] = await tx.update(taskStages).set({ status: "active", integrationNote: input.note?.trim() || null, updatedAt: new Date() }).where(and(eq(taskStages.id, row.stage.id), eq(taskStages.status, "integrating"))).returning({ id: taskStages.id });
      if (!reopened) throw new AppError("该阶段状态已变化，请刷新后重试");
      return;
    }
    const [completed] = await tx.update(taskStages).set({ status: "completed", integrationNote: input.note?.trim() || null, reviewedById: actorId, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(taskStages.id, row.stage.id), eq(taskStages.status, "integrating"))).returning({ id: taskStages.id });
    if (!completed) throw new AppError("该阶段状态已变化，请刷新后重试");
    const [next] = await tx.select({ id: taskStages.id }).from(taskStages).where(and(eq(taskStages.projectId, row.stage.projectId), eq(taskStages.status, "locked"))).orderBy(asc(taskStages.position)).limit(1);
    if (next) {
      await tx.update(taskStages).set({ status: "active", updatedAt: new Date() }).where(eq(taskStages.id, next.id));
      await enqueueStageHandoffs(tx, next.id, row.stage.id);
    }
  });
}
