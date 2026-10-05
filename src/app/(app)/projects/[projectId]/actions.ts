"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  claimTask,
  createTask,
  declineTask,
  deleteTask,
  getTaskDetail,
  reviewTask,
  setTaskSuccessors,
  submitTask,
  updateTask,
} from "@/lib/task";
import { setTaskLabels } from "@/lib/label";
import { createMilestone } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";
import { TASK_STATUSES } from "@/lib/task-status";
import { createEntry, deleteEntry } from "@/lib/entry";
import { createEvidenceItem, EVIDENCE_LABEL, missingRequiredEvidence } from "@/lib/evidence";
import { EVIDENCE_TYPES, type EvidenceType } from "@/lib/handoff";

export type FormState = { error: string } | null;
export type CreateTaskState = { error: string } | { ok: true; revision: string } | null;
// 更新任务专用：成功回 { ok: true }，供编辑弹窗据以自闭
export type UpdateTaskState = { error: string } | { ok: true } | null;

const createTaskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写任务标题"),
  description: z.string().trim().optional(),
  assigneeId: z.uuid().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  dueDate: z.iso.date("日期格式不正确").optional(),
  milestoneId: z.uuid().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

export async function createTaskAction(
  _prev: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createTaskSchema.safeParse({
    ...raw,
    assigneeId: raw.assigneeId || undefined,
    startDate: raw.startDate || undefined,
    dueDate: raw.dueDate || undefined,
    milestoneId: raw.milestoneId || undefined,
    priority: raw.priority || undefined,
    status: raw.status || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { projectId, ...input } = parsed.data;
  try {
    await createTask(session.user.id, projectId, input);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限创建任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, revision: crypto.randomUUID() };
}

const createMilestoneSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写里程碑标题"),
  targetDate: z.iso.date("日期格式不正确").optional(),
});

export async function createMilestoneAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createMilestoneSchema.safeParse({
    ...raw,
    targetDate: raw.targetDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createMilestone(session.user.id, parsed.data.projectId, {
      title: parsed.data.title,
      targetDate: parsed.data.targetDate,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可创建里程碑" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

// 拖拽可改的字段白名单。状态不在拖拽路径里：状态推进必须经过任务动作，
// 否则「拖到已完成」会绕开提交与人工验收。校验与授权仍全数落在 updateTask。
const movePatchSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  milestoneId: z.uuid().nullable().optional(),
});

const moveTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  patch: movePatchSchema,
});

export async function moveTaskAction(input: {
  taskId: string;
  projectId: string;
  patch: z.infer<typeof movePatchSchema>;
}): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "参数无效" };
  // 空补丁无事可做，视为非法请求
  if (Object.keys(parsed.data.patch).length === 0) return { error: "参数无效" };

  try {
    if (parsed.data.patch.status !== undefined) {
      return { error: "状态不能通过拖拽改变，请使用任务动作推进" };
    }
    await updateTask(session.user.id, parsed.data.taskId, parsed.data.patch);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限移动任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const updateTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  title: z.string().trim().min(1, "标题不可为空"),
  description: z.string().trim().optional(),
  assigneeId: z.uuid().optional(),
  milestoneId: z.uuid().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  dueDate: z.iso.date("日期格式不正确").optional(),
  priority: z.enum(["low", "medium", "high"]),
  completionNote: z.string().trim().optional(),
});

export async function updateTaskAction(
  _prev: UpdateTaskState,
  formData: FormData,
): Promise<UpdateTaskState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = updateTaskSchema.safeParse({
    ...raw,
    assigneeId: raw.assigneeId || undefined,
    milestoneId: raw.milestoneId || undefined,
    startDate: raw.startDate || undefined,
    dueDate: raw.dueDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { taskId, projectId, ...patch } = parsed.data;
  const successorIds = formData
    .getAll("successorIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const labelIds = formData
    .getAll("labelIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  try {
    await updateTask(session.user.id, taskId, {
      title: patch.title,
      description: patch.description ?? null,
      assigneeId: patch.assigneeId ?? null,
      milestoneId: patch.milestoneId ?? null,
      startDate: patch.startDate ?? null,
      dueDate: patch.dueDate ?? null,
      priority: patch.priority,
      completionNote: patch.completionNote ?? null,
    });
    await setTaskSuccessors(session.user.id, taskId, successorIds);
    await setTaskLabels(session.user.id, taskId, labelIds);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const updateTaskHandoffSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  assigneeId: z.string().optional(),
  handoffBrief: z.string().trim().optional(),
  doneCriteria: z.string().optional(),
  requiredEvidence: z.string().trim().optional(),
  responseDueAt: z.string().optional(),
  contextPackId: z.string().optional(),
});

export async function updateTaskHandoffAction(
  _prev: UpdateTaskState,
  formData: FormData,
): Promise<UpdateTaskState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const rawEvidence = formData.getAll("requiredEvidence");
  const evidenceJoined =
    rawEvidence.length > 0
      ? rawEvidence.map((e) => String(e).trim()).filter(Boolean).join(",")
      : raw.requiredEvidence
        ? String(raw.requiredEvidence).trim()
        : undefined;

  const parsed = updateTaskHandoffSchema.safeParse({
    ...raw,
    assigneeId: raw.assigneeId === "" ? undefined : (raw.assigneeId ? String(raw.assigneeId) : undefined),
    handoffBrief: raw.handoffBrief || undefined,
    doneCriteria: raw.doneCriteria || undefined,
    requiredEvidence: evidenceJoined || undefined,
    responseDueAt: raw.responseDueAt || undefined,
    contextPackId: raw.contextPackId || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { taskId, projectId, assigneeId, handoffBrief, doneCriteria, requiredEvidence, responseDueAt, contextPackId } = parsed.data;

  const criteriaList = doneCriteria
    ? doneCriteria
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  let parsedDueDate: Date | null | undefined = undefined;
  if (responseDueAt) {
    const d = new Date(responseDueAt);
    if (!isNaN(d.getTime())) {
      parsedDueDate = d;
    }
  }

  const evidenceList = requiredEvidence
    ? requiredEvidence
        .split(/[,，、\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is EvidenceType =>
          (EVIDENCE_TYPES as readonly string[]).includes(s),
        )
    : undefined;

  try {
    const current = await getTaskDetail(session.user.id, taskId);
    if (current.status === "review" || current.status === "done") {
      return { error: "已进入验收或已完成的任务不可直接修改交接契约，请先退回修改" };
    }

    await updateTask(session.user.id, taskId, {
      ...(assigneeId !== undefined && { assigneeId: assigneeId === "unassigned" ? null : assigneeId }),
      handoffBrief: handoffBrief ?? null,
      doneCriteria: criteriaList ?? null,
      requiredEvidence: evidenceList && evidenceList.length > 0 ? evidenceList : null,
      responseDueAt: parsedDueDate ?? null,
      contextPackId: contextPackId && z.uuid().safeParse(contextPackId).success ? contextPackId : null,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改交接要求" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const deleteTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
});

export async function deleteTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteTask(session.user.id, parsed.data.taskId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限删除任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

// ============ 承诺与验收 ============
//
// 三枚 action 同构于既有的五步：auth → 空串归一 → safeParse → try/catch → revalidatePath。
// 错误一律回中文文案，由卡片就地展示而非弹全局提示。

const claimTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  commitmentNote: z.string().trim().min(1, "请写一句你打算怎么做"),
  estimatedHours: z.coerce.number().positive("预估工时须为正数").max(999).optional(),
});

export async function claimTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = claimTaskSchema.safeParse({
    ...raw,
    estimatedHours: raw.estimatedHours || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await claimTask(session.user.id, parsed.data.taskId, {
      commitmentNote: parsed.data.commitmentNote,
      estimatedHours: parsed.data.estimatedHours,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限认领此任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

// ============ 项目档案 ============

const createEntrySchema = z.object({
  projectId: z.uuid(),
  taskId: z.string().optional(),
  type: z.enum(["feedback", "doc", "deliverable"]),
  title: z.string().trim().min(1, "请写个标题"),
  content: z.string().trim().optional(),
  url: z.string().trim().optional(),
});

export async function createEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createEntrySchema.safeParse({
    ...raw,
    taskId: raw.taskId || undefined,
    content: raw.content || undefined,
    url: raw.url || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createEntry(session.user.id, parsed.data.projectId, {
      type: parsed.data.type,
      title: parsed.data.title,
      content: parsed.data.content,
      url: parsed.data.url,
      taskId: parsed.data.taskId ?? null,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "你没有权限在这里留这条" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const deleteEntrySchema = z.object({ entryId: z.uuid(), projectId: z.uuid() });

export async function deleteEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteEntrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteEntry(session.user.id, parsed.data.entryId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有作者本人或组长可以删除" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const declineTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  reason: z.string().trim().min(1, "请说明为什么接不住"),
});

// 「接不住」——本产品区别于普通任务分派的那条边。
// 只有被派的人本人能说（admin 也代不了，那是第一人称的判断）。
export async function declineTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = declineTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await declineTask(session.user.id, parsed.data.taskId, { reason: parsed.data.reason });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有任务负责人本人可以接不住" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const submitTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  completionNote: z.string().trim().min(1, "请说明这次交付了什么"),
});

export async function submitTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = submitTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    // 把必需材料随交付表单一并落库。之前页面只收完成说明，
    // 但 submitTask 会拒绝缺少契约证据的任务，成员因此没有可完成的路径。
    const missingBeforeSubmit = await missingRequiredEvidence(session.user.id, parsed.data.taskId);
    const evidenceValues = new Map<EvidenceType, string>();
    for (const type of missingBeforeSubmit) {
      const value = String(formData.get(`evidence_${type}`) ?? "").trim();
      if (!value) {
        const labels = missingBeforeSubmit.map((missingType) => EVIDENCE_LABEL[missingType]);
        return { error: `请补充必需交付材料：${labels.join("、")}` };
      }
      if (value.length > 8_000) return { error: `${EVIDENCE_LABEL[type]}最多 8000 个字` };
      evidenceValues.set(type, value);
    }

    for (const [type, value] of evidenceValues) {
      await createEvidenceItem(session.user.id, parsed.data.taskId, {
        type,
        label: EVIDENCE_LABEL[type],
        value,
      });
    }

    await submitTask(session.user.id, parsed.data.taskId, {
      completionNote: parsed.data.completionNote,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有任务负责人本人可以提交" };
    if (e instanceof AppError) {
      const missing = e.message.match(/^还缺少必需证据：(.*)$/);
      if (missing) {
        const labels = missing[1]
          .split("、")
          .map((type) => EVIDENCE_LABEL[type as EvidenceType] ?? type);
        return { error: `请补充必需交付材料：${labels.join("、")}` };
      }
      return { error: e.message };
    }
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const reviewTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  decision: z.enum(["accept", "reject"]),
  note: z.string().trim().optional(),
});

export async function reviewTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = reviewTaskSchema.safeParse({ ...raw, note: raw.note || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await reviewTask(session.user.id, parsed.data.taskId, {
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有组长或教师可以验收" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}
