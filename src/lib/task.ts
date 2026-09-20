import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import {
  labels,
  milestones,
  contextPacks,
  taskDependencies,
  taskLabels,
  tasks,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";
import { isTeamAgent } from "./agent-member";
import { getProjectForUser } from "./project";
import {
  notifyTaskAssigned,
  notifyTaskCompleted,
  notifyTaskDeclined,
  notifyTaskReviewed,
  notifyTaskSubmitted,
} from "./notify";
import { DEFAULT_STATUS, assertTransition, isCompleted } from "./task-status";
import { normalizeHandoffFields, type HandoffFields } from "./handoff";
import { missingRequiredEvidence } from "./evidence";
import { describe, recordEvent } from "./activity";
import type { ActivityType } from "@/db/schema";

// 任务写操作角色：admin + student（teacher 只读，设计文档 §5）
const TASK_WRITE_ROLES = ["admin", "student"];

async function requireProjectAccess(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

// 供 lib/label.ts 复用：贴标签属任务写操作，权限口径须与 createTask/updateTask 一致。
// ⚠️ 语义与签名冻结，勿动——lib/label.ts 依赖它。收窄或放宽都会连带改动贴标签权限。
export async function requireTaskWrite(actorId: string, projectId: string) {
  const access = await requireProjectAccess(actorId, projectId);
  if (!TASK_WRITE_ROLES.includes(access.role)) throw new ForbiddenError();
  return access;
}

// 执行类动作（认领、提交成果）：负责人本人，或 admin 代操作。
// teacher 被拒——验收人不能同时是提交人，这条边界是「学生可自证」的前提。
export async function requireTaskExecution(
  actorId: string,
  task: { projectId: string; assigneeId: string | null },
) {
  const access = await requireProjectAccess(actorId, task.projectId);
  if (access.role === "admin") return access;
  if (task.assigneeId !== actorId) throw new ForbiddenError("只有任务负责人本人可以执行此操作");
  return access;
}

// 验收类动作（通过、退回）：admin 或 teacher。
// teacher 由此从纯只读升为可验收——这是全项目里教师第一次拿到写入能力，
// 也正是开题报告「组长或教师进行验收或退回」那句的落点。
export async function requireTaskReview(actorId: string, projectId: string) {
  const access = await requireProjectAccess(actorId, projectId);
  if (access.role !== "admin" && access.role !== "teacher")
    throw new ForbiddenError("只有组长或教师可以验收任务");
  return access;
}

// 阻塞上报：admin 或 student。teacher 不报自身阻塞（他不是干活的人）。
export async function requireTaskReport(actorId: string, projectId: string) {
  const access = await requireProjectAccess(actorId, projectId);
  if (access.role === "teacher") throw new ForbiddenError();
  return access;
}

// 除状态与指派外，其余可编辑字段。用于判断「是否只是改了点别的」
const OTHER_EDIT_FIELDS = [
  "title",
  "description",
  "dueDate",
  "startDate",
  "milestoneId",
  "priority",
  "completionNote",
] as const;

// 取姓名供事件摘要冻结。读 users 表，事务内读到的是已提交值——
// 本函数只服务于「改派」这一条路径，彼时被指派人必已存在，无脏读之虞。
async function userName(userId: string): Promise<string | null> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name ?? null;
}

// 负责人可以是人，也可以是 agent（agent 不占 team_members 的席位）。
// 两者合起来才是完整的「这个负责人确实归本团队」。
async function validateAssignee(teamId: string, assigneeId: string) {
  const membership = await getTeamMembership(assigneeId, teamId);
  if (membership) return;
  if (await isTeamAgent(assigneeId, teamId)) return;
  throw new AppError("负责人不是团队成员");
}

async function validateMilestone(projectId: string, milestoneId: string) {
  const [m] = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)));
  if (!m) throw new AppError("里程碑不属于该项目");
}

// 父任务须存在且同项目——防跨项目挂载
async function validateParentTask(projectId: string, parentTaskId: string) {
  const [p] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parentTaskId), eq(tasks.projectId, projectId)));
  if (!p) throw new AppError("父任务不属于该项目");
}

export async function createTask(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    parentTaskId?: string;
    handoffBrief?: string;
    doneCriteria?: string[];
    requiredEvidence?: HandoffFields["requiredEvidence"];
    responseDueAt?: Date;
    contextPackId?: string | null;
  },
  opts?: { tx?: DbTx },
) {
  const exec = opts?.tx ?? db;
  const access = await requireTaskWrite(actorId, projectId);
  if (input.assigneeId) await validateAssignee(access.project.teamId, input.assigneeId);
  if (input.milestoneId) await validateMilestone(projectId, input.milestoneId);
  if (input.parentTaskId) await validateParentTask(projectId, input.parentTaskId);
  const handoff = normalizeHandoffFields(input);
  if (handoff.contextPackId) {
    const [pack] = await exec
      .select({ projectId: contextPacks.projectId, status: contextPacks.status })
      .from(contextPacks)
      .where(eq(contextPacks.id, handoff.contextPackId));
    if (!pack || pack.projectId !== projectId || pack.status !== "frozen") {
      throw new AppError("交接契约只能关联当前项目的冻结上下文包");
    }
  }

  const [task] = await exec
    .insert(tasks)
    .values({
      projectId,
      createdById: actorId,
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      startDate: input.startDate,
      dueDate: input.dueDate,
      milestoneId: input.milestoneId,
      parentTaskId: input.parentTaskId,
      handoffBrief: handoff.handoffBrief,
      doneCriteria: handoff.doneCriteria,
      requiredEvidence: handoff.requiredEvidence,
      responseDueAt: handoff.responseDueAt,
      contextPackId: handoff.contextPackId,
      priority: input.priority ?? "medium",
      status: input.status ?? DEFAULT_STATUS,
      sortOrder: Date.now(),
    })
    .returning();

  // 事件与任务同事务：传 exec 而非全局 db，回滚时事件一并回滚，不留「没发生过的动作」
  await recordEvent(exec, {
    projectId,
    actorId,
    type: "task_created",
    taskId: task.id,
    summary: describe.taskCreated(task.title),
    payload: { title: task.title, status: task.status, assigneeId: task.assigneeId },
  });

  // 非事务路径：即时通知（fire-and-forget，通知内部已吞异常）。事务路径由调用方提交后补发。
  if (!opts?.tx && task.assigneeId) void notifyTaskAssigned(task);
  return task;
}

export async function updateTask(
  actorId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    assigneeId?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    completionNote?: string | null;
    handoffBrief?: string | null;
    doneCriteria?: string[] | null;
    requiredEvidence?: HandoffFields["requiredEvidence"];
    responseDueAt?: Date | null;
    contextPackId?: string | null;
  },
  opts?: { tx?: DbTx },
) {
  const exec = opts?.tx ?? db;
  const [task] = await exec.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  // 顺序不可易：先权限，再归属，最后状态机。
  // 若状态机前置，「无权限者改状态」会得到状态机文案而非「没有权限」，
  // 既是信息泄露，也会让 tests/task.test.ts 的越权断言失准。
  const access = await requireTaskWrite(actorId, task.projectId);
  if (patch.assigneeId) await validateAssignee(access.project.teamId, patch.assigneeId);
  if (patch.milestoneId) await validateMilestone(task.projectId, patch.milestoneId);
  if (patch.status !== undefined) assertTransition(task.status, patch.status, access.role);
  const handoffPatch =
    patch.handoffBrief !== undefined ||
    patch.doneCriteria !== undefined ||
    patch.requiredEvidence !== undefined ||
    patch.responseDueAt !== undefined ||
    patch.contextPackId !== undefined
      ? normalizeHandoffFields({
          handoffBrief: patch.handoffBrief ?? task.handoffBrief,
          doneCriteria: (patch.doneCriteria ?? task.doneCriteria) as string[] | null,
          requiredEvidence: (patch.requiredEvidence ?? task.requiredEvidence) as HandoffFields["requiredEvidence"],
          responseDueAt: patch.responseDueAt ?? task.responseDueAt,
          contextPackId: patch.contextPackId ?? task.contextPackId,
        })
      : null;
  const sameHandoffValue = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const handoffChanged = Boolean(
    handoffPatch &&
      (!sameHandoffValue(task.handoffBrief, handoffPatch.handoffBrief) ||
        !sameHandoffValue(task.doneCriteria, handoffPatch.doneCriteria) ||
        !sameHandoffValue(task.requiredEvidence, handoffPatch.requiredEvidence) ||
        (task.responseDueAt?.getTime() ?? null) !== (handoffPatch.responseDueAt?.getTime() ?? null) ||
        !sameHandoffValue(task.contextPackId, handoffPatch.contextPackId)),
  );
  if (handoffPatch?.contextPackId) {
    const [pack] = await exec
      .select({ projectId: contextPacks.projectId, status: contextPacks.status })
      .from(contextPacks)
      .where(eq(contextPacks.id, handoffPatch.contextPackId));
    if (!pack || pack.projectId !== task.projectId || pack.status !== "frozen") {
      throw new AppError("交接契约只能关联当前项目的冻结上下文包");
    }
  }

  // 改派即重置承诺：新负责人没答应过任何事，旧的承诺不能跟着任务走。
  // 少了这一步，改派后的任务会显示「已接住」，而接手的人根本还没开口——
  // 那正是 isAwaitingResponse 想抓住的那种悬空状态，反倒被我们自己掩盖了。
  const reassigned = patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId;

  // 显式白名单构造，勿用 ...patch 展开：运行时宽对象可夹带 projectId/sortOrder 等越权字段
  const [updated] = await exec
    .update(tasks)
    // updatedAt 取 DB 时钟（now()）而非宿主机 new Date()：与 createdAt 的 defaultNow() 同源，保证单调性
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.assigneeId !== undefined && { assigneeId: patch.assigneeId }),
      ...(reassigned && {
        commitmentNote: null,
        committedAt: null,
        committedHandoffVersion: null,
        estimatedHours: null,
        // 上一次「接不住」的理由也一并清掉：它说的是上一个人，对新负责人是误导
        declineReason: null,
        declinedAt: null,
        declinedById: null,
      }),
      ...(patch.startDate !== undefined && { startDate: patch.startDate }),
      ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
      ...(patch.milestoneId !== undefined && { milestoneId: patch.milestoneId }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.completionNote !== undefined && { completionNote: patch.completionNote }),
      ...(handoffPatch && {
        handoffBrief: handoffPatch.handoffBrief,
        doneCriteria: handoffPatch.doneCriteria,
        requiredEvidence: handoffPatch.requiredEvidence,
        responseDueAt: handoffPatch.responseDueAt,
        contextPackId: handoffPatch.contextPackId,
      }),
      ...(handoffChanged && { handoffVersion: sql`${tasks.handoffVersion} + 1` }),
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new AppError("任务不存在");

  // 事件与更新同事务。前像 task 已在上面取到，diff 零成本。
  const events: { type: ActivityType; summary: string; payload: Record<string, unknown> }[] = [];

  if (patch.status !== undefined && patch.status !== task.status) {
    events.push({
      type: "task_status_changed",
      summary: describe.taskStatusChanged(updated.title, task.status, patch.status),
      payload: { title: updated.title, from: task.status, to: patch.status },
    });
  }

  if (patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId) {
    const name = patch.assigneeId ? await userName(patch.assigneeId) : null;
    events.push({
      type: "task_assigned",
      summary: describe.taskAssigned(updated.title, name),
      payload: { title: updated.title, to: patch.assigneeId, toName: name },
    });
  }

  // 状态与指派各有专事件，则不再叠一笔笼统的「修改了」
  if (events.length === 0 && OTHER_EDIT_FIELDS.some((k) => patch[k] !== undefined)) {
    events.push({
      type: "task_updated",
      summary: describe.taskUpdated(updated.title),
      payload: { title: updated.title },
    });
  }

  for (const e of events) {
    await recordEvent(exec, { projectId: task.projectId, actorId, taskId: task.id, ...e });
  }

  if (!opts?.tx) {
    // 改派：通知新负责人
    if (patch.assigneeId && patch.assigneeId !== task.assigneeId) void notifyTaskAssigned(updated);
    // 完成：通知创建者(≠操作者)。注意是「转为已完成」才发——
    // 提交验收（→review）只算交活，不该惊动创建者
    if (patch.status !== undefined && isCompleted(patch.status) && !isCompleted(task.status))
      void notifyTaskCompleted(updated, actorId);
  }
  return updated;
}

export async function deleteTask(actorId: string, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, task.projectId);

  await db.transaction(async (tx) => {
    await tx.delete(tasks).where(eq(tasks.id, taskId));
    // taskId 传 null：行已删，外键约束在，指过去必违约。
    // 原 id 落进 payload —— 外键虽断，复盘仍要能指认删的是哪一个。
    await recordEvent(tx, {
      projectId: task.projectId,
      actorId,
      type: "task_deleted",
      taskId: null,
      summary: describe.taskDeleted(task.title),
      payload: { taskId, title: task.title, status: task.status },
    });
  });
}

export type TaskLabel = { id: string; name: string; color: string };

// 另发一次查询按 taskId 归并，不用 leftJoin：join 会造成行乘积，
// 污染既有 orderBy(sortOrder) 与调用方「一行一任务」的假设。
async function labelsByTask(taskIds: string[]): Promise<Map<string, TaskLabel[]>> {
  const map = new Map<string, TaskLabel[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({
      taskId: taskLabels.taskId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(inArray(taskLabels.taskId, taskIds))
    .orderBy(labels.name);

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.taskId, list);
  }
  return map;
}

// 刻意窄的任务投影：只给接力链用的四个字段。
// 「现场」模式渲染一张接力表，不该付任务明细（描述、承诺、验收、
// 标签、子任务……）的代价。调用方须自行确认权限——
// 本函数不做校验，故仅供已收口的内部路径使用。
export async function listTaskRefs(projectId: string) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
}

export async function listProjectTasks(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      handoffBrief: tasks.handoffBrief,
      doneCriteria: tasks.doneCriteria,
      requiredEvidence: tasks.requiredEvidence,
      responseDueAt: tasks.responseDueAt,
      contextPackId: tasks.contextPackId,
      handoffVersion: tasks.handoffVersion,
      committedHandoffVersion: tasks.committedHandoffVersion,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      sortOrder: tasks.sortOrder,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      updatedAt: tasks.updatedAt,
      completionNote: tasks.completionNote,
      // 承诺与验收诸字段：界面要靠它们决定「该显示哪个按钮」
      // （我是不是负责人？我是不是创建者？这活是不是待我验收？）
      createdById: tasks.createdById,
      commitmentNote: tasks.commitmentNote,
      committedAt: tasks.committedAt,
      estimatedHours: tasks.estimatedHours,
      submittedAt: tasks.submittedAt,
      reviewedAt: tasks.reviewedAt,
      reviewedById: tasks.reviewedById,
      reviewNote: tasks.reviewNote,
      rejectCount: tasks.rejectCount,
      // 接住与否、以及上一次接不住的理由——卡片要靠它判断显示哪枚按钮
      declineReason: tasks.declineReason,
      declinedAt: tasks.declinedAt,
      declinedById: tasks.declinedById,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(tasks.sortOrder);

  const byTask = await labelsByTask(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, labels: byTask.get(r.id) ?? [] }));
}

// 列某任务之下的子任务（直接子级，不递归）
export async function listSubtasks(actorId: string, parentTaskId: string) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, parent.projectId);

  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      handoffBrief: tasks.handoffBrief,
      doneCriteria: tasks.doneCriteria,
      requiredEvidence: tasks.requiredEvidence,
      responseDueAt: tasks.responseDueAt,
      contextPackId: tasks.contextPackId,
      handoffVersion: tasks.handoffVersion,
      committedHandoffVersion: tasks.committedHandoffVersion,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      completionNote: tasks.completionNote,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(tasks.sortOrder);
}

// 在某任务下建子任务：projectId 由父任务推得，调用方无须再传。
// 新建行必无既有子级，故不可能成环，无须环检测。
export async function createSubtask(
  actorId: string,
  parentTaskId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
    handoffBrief?: string;
    doneCriteria?: string[];
    requiredEvidence?: HandoffFields["requiredEvidence"];
    responseDueAt?: Date;
    contextPackId?: string | null;
  },
) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  return createTask(actorId, parent.projectId, { ...input, parentTaskId });
}

// 单任务详情（供 Agent API 按 id 直取）。权限口径同 listProjectTasks：项目成员即可读。
// 注：「任务不存在」先于权限返回，沿既有 updateTask/deleteTask 之口径（BACKLOG 已录此债）。
export async function getTaskDetail(actorId: string, taskId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      description: tasks.description,
      handoffBrief: tasks.handoffBrief,
      doneCriteria: tasks.doneCriteria,
      requiredEvidence: tasks.requiredEvidence,
      responseDueAt: tasks.responseDueAt,
      contextPackId: tasks.contextPackId,
      handoffVersion: tasks.handoffVersion,
      committedHandoffVersion: tasks.committedHandoffVersion,
      completionNote: tasks.completionNote,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      updatedAt: tasks.updatedAt,
      createdAt: tasks.createdAt,
      createdById: tasks.createdById,
      commitmentNote: tasks.commitmentNote,
      committedAt: tasks.committedAt,
      estimatedHours: tasks.estimatedHours,
      submittedAt: tasks.submittedAt,
      reviewedAt: tasks.reviewedAt,
      reviewedById: tasks.reviewedById,
      reviewNote: tasks.reviewNote,
      rejectCount: tasks.rejectCount,
      declineReason: tasks.declineReason,
      declinedAt: tasks.declinedAt,
      declinedById: tasks.declinedById,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.id, taskId));
  if (!row) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, row.projectId);
  const byTask = await labelsByTask([row.id]);
  return { ...row, labels: byTask.get(row.id) ?? [] };
}

// ============ 任务承诺与验收 ============
//
// 三段式：认领（承诺）→ 提交（交活）→ 验收（判）。三者是三条独立写路径，
// 不走 updateTask：那条路的权限口径是「项目写权限」，而这三件事各有各的主体
// （负责人本人 / 负责人本人 / 组长与教师），混在一起会让权限表越缠越乱。

// 认领任务并立下承诺。
//
// 并发安全靠条件更新，不用「先查后写」——两人同抢一个未指派任务时，
// 先查后写会双双通过检查。照 resource.ts 的 endResourceUsage 之形制：
// WHERE 带前置条件，0 行即表示已被抢先。
export async function claimTask(
  actorId: string,
  taskId: string,
  input: { commitmentNote: string; estimatedHours?: number },
) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, task.projectId);
  if (task.assigneeId && task.assigneeId !== actorId)
    throw new AppError("该任务已有负责人，请先请对方移交");

  const [claimed] = await db
    .update(tasks)
    .set({
      assigneeId: actorId,
      commitmentNote: input.commitmentNote,
      estimatedHours: input.estimatedHours ?? null,
      committedAt: sql`now()`,
      committedHandoffVersion: task.handoffVersion,
      // 未开始的活一经认领即进入进行中；已在进行中的不动档位
      ...(task.status === "todo" && { status: "doing" as const }),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        // 空则可抢；已是自己的则可改承诺；他人持有一律 0 行
        or(isNull(tasks.assigneeId), eq(tasks.assigneeId, actorId)),
      ),
    )
    .returning();
  // 0 行＝条件不成立，必是并发下被他人抢先
  if (!claimed) throw new AppError("该任务刚被他人认领");

  await recordEvent(db, {
    projectId: task.projectId,
    actorId,
    type: "task_claimed",
    taskId,
    summary: describe.taskClaimed(claimed.title, input.commitmentNote),
    payload: {
      title: claimed.title,
      commitmentNote: input.commitmentNote,
      estimatedHours: input.estimatedHours ?? null,
    },
  });
  if (task.assigneeId !== actorId) void notifyTaskAssigned(claimed);
  return claimed;
}

// 接不住：把活退回去，并说清为什么。
//
// 这是「接住」的对称面，也是本项目区别于普通任务分派的那条边。
// 没有它，「指派」就是单方面的：派的人以为有人在做，被派的人其实做不了，
// 而这份误会要到 deadline 才会暴露——那时已经来不及了。
//
// 允许 agent 调用（agent 接不住时会静默失败，比人不吭声更难发现）。
export async function declineTask(actorId: string, taskId: string, input: { reason: string }) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, task.projectId);

  // 「接不住」是第一人称的判断，别人替不了。
  // 故此处的口子比 submitTask 更窄：admin 能代交成果，却不能代说接不住——
  // 那等于替别人承认「我干不了」，语义上说不通。
  if (task.assigneeId !== actorId) throw new ForbiddenError("只有任务负责人本人可以接不住");
  if (!input.reason.trim()) throw new AppError("请说明为什么接不住——派活的人要据此改派");

  const prevAssignee = task.assigneeId;
  const [updated] = await db
    .update(tasks)
    .set({
      // 退回未指派：留着 assigneeId 会让看板上看着像有人在管
      assigneeId: null,
      status: "todo",
      // 承诺一并清空——没接住的活谈不上兑现
      commitmentNote: null,
      committedAt: null,
      estimatedHours: null,
      declineReason: input.reason,
      declinedAt: sql`now()`,
      declinedById: actorId,
      updatedAt: sql`now()`,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.assigneeId, actorId)))
    .returning();
  // 0 行＝并发下已被改派，此时再退就是退别人的活
  if (!updated) throw new AppError("该任务已被改派，无需再接不住");

  await recordEvent(db, {
    projectId: task.projectId,
    actorId,
    type: "task_declined",
    taskId,
    summary: describe.taskDeclined(updated.title, input.reason),
    payload: { title: updated.title, reason: input.reason, prevAssignee },
  });
  void notifyTaskDeclined(updated, actorId, input.reason);
  return updated;
}

// 提交成果，落入待验收。
// 只有负责人本人（或 admin 代操作）可提交——这是「谁干的活谁交」。
export async function submitTask(
  actorId: string,
  taskId: string,
  input: { completionNote: string },
) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireTaskExecution(actorId, task);
  if (task.status === "review") throw new AppError("该任务已在待验收中");
  if (task.status === "done") throw new AppError("该任务已通过验收，如需改动请先重开");
  if (!input.completionNote.trim()) throw new AppError("请说明这次交付了什么");
  if (
    task.committedAt &&
    task.committedHandoffVersion !== null &&
    task.committedHandoffVersion !== task.handoffVersion
  ) {
    throw new AppError("交接契约已更新，请重新确认你的承诺后再提交");
  }
  const missingEvidence = await missingRequiredEvidence(actorId, taskId);
  if (missingEvidence.length > 0) {
    throw new AppError(`还缺少必需证据：${missingEvidence.join("、")}`);
  }

  const [updated] = await db
    .update(tasks)
    .set({
      status: "review",
      completionNote: input.completionNote,
      submittedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new AppError("任务不存在");

  await recordEvent(db, {
    projectId: task.projectId,
    actorId,
    type: "task_submitted",
    taskId,
    summary: describe.taskSubmitted(updated.title),
    payload: {
      title: updated.title,
      completionNote: input.completionNote,
      // 冻结交付人：贡献记录要按「谁交的」归属，而任务事后可能改派，
      // 事后再查任务行会张冠李戴
      assigneeId: updated.assigneeId,
    },
  });
  void notifyTaskSubmitted(updated);
  return updated;
}

// 验收：通过则落 done，退回则回 doing 且计入一次返工。
// 主体是组长或教师——这是全项目里教师第一次能写。
export async function reviewTask(
  actorId: string,
  taskId: string,
  input: { decision: "accept" | "reject"; note?: string },
) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireTaskReview(actorId, task.projectId);
  if (task.status !== "review") throw new AppError("该任务不在待验收状态");
  // 不能验收自己交付的活。教师若恰好也是这份任务的负责人，就该由别人来判——
  // 否则「验收」二字形同虚设，学生自证与教师自证并无分别。
  if (task.assigneeId === actorId) throw new AppError("不能验收自己交付的任务");

  const accepted = input.decision === "accept";
  // 退回必填理由：没写理由的退回，成员只知道被否了，不知道改什么
  if (!accepted && !input.note?.trim()) throw new AppError("退回时请写明需要改什么");

  const [updated] = await db
    .update(tasks)
    .set({
      status: accepted ? "done" : "doing",
      reviewedAt: sql`now()`,
      reviewedById: actorId,
      reviewNote: input.note ?? null,
      ...(accepted ? {} : { rejectCount: sql`${tasks.rejectCount} + 1` }),
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new AppError("任务不存在");

  await recordEvent(db, {
    projectId: task.projectId,
    actorId,
    type: accepted ? "task_accepted" : "task_rejected",
    taskId,
    summary: accepted
      ? describe.taskAccepted(updated.title)
      : describe.taskRejected(updated.title, input.note ?? ""),
    payload: {
      title: updated.title,
      note: input.note ?? null,
      // 同 submitTask：把交付人冻在这一笔事件里。
      // 贡献记录的头条数字（被验收通过的任务数）就数它。
      assigneeId: updated.assigneeId,
      reviewerId: actorId,
    },
  });
  // 通过时才通知创建者「完成了」——退回走另一张卡片
  if (accepted) void notifyTaskCompleted(updated, actorId);
  void notifyTaskReviewed(updated, input.decision, input.note ?? null, actorId);
  return updated;
}

// 设置 predecessor 的后置任务（先删旧再插新）。简单关联：仅防直接成环，不强制阻断执行。
// 任务抽屉要的那一份。比 getTaskDetail 多一样东西：负责人的 kind，
// 界面据此决定给不给他挂「AI」标识。
// 权限沿用项目成员口径（与 getTaskDetail 一致）。
export async function getDrawerTask(actorId: string, taskId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      assigneeKind: users.kind,
      handoffBrief: tasks.handoffBrief,
      doneCriteria: tasks.doneCriteria,
      requiredEvidence: tasks.requiredEvidence,
      responseDueAt: tasks.responseDueAt,
      contextPackId: tasks.contextPackId,
      handoffVersion: tasks.handoffVersion,
      committedHandoffVersion: tasks.committedHandoffVersion,
      commitmentNote: tasks.commitmentNote,
      committedAt: tasks.committedAt,
      completionNote: tasks.completionNote,
      reviewNote: tasks.reviewNote,
      rejectCount: tasks.rejectCount,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.id, taskId));
  if (!row) return null;
  await requireProjectAccess(actorId, row.projectId);
  const byTask = await labelsByTask([row.id]);
  return { ...row, labels: byTask.get(row.id) ?? [] };
}

export async function setTaskSuccessors(
  actorId: string,
  predecessorId: string,
  successorIds: string[],
) {
  const [pred] = await db.select().from(tasks).where(eq(tasks.id, predecessorId));
  if (!pred) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, pred.projectId);

  for (const sid of successorIds) {
    if (sid === predecessorId) throw new AppError("后置任务不可构成循环");
    const [s] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, sid));
    if (!s || s.projectId !== pred.projectId)
      throw new AppError("后置任务不属于该项目");
    const [back] = await db
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.predecessorId, sid),
          eq(taskDependencies.successorId, predecessorId),
        ),
      );
    if (back) throw new AppError("后置任务不可构成循环");
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskDependencies).where(eq(taskDependencies.predecessorId, predecessorId));
    if (successorIds.length > 0) {
      await tx
        .insert(taskDependencies)
        .values(successorIds.map((sid) => ({ predecessorId, successorId: sid })));
    }
    // 并入既有事务，与依赖表同生共死
    await recordEvent(tx, {
      projectId: pred.projectId,
      actorId,
      type: "task_dependency_changed",
      taskId: predecessorId,
      summary: describe.taskDependencyChanged(pred.title, successorIds.length),
      payload: { title: pred.title, successorCount: successorIds.length, successorIds },
    });
  });
}

export async function listProjectDependencies(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  return db
    .select({
      predecessorId: taskDependencies.predecessorId,
      successorId: taskDependencies.successorId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(eq(tasks.projectId, projectId));
}
