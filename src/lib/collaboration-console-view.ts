import { type TaskStatus } from "./task-status";

/**
 * 协同执行台只依赖这些轻量类型，不能从 schema.ts 导入。
 * 这样同一套排序/文案规则既能在服务端使用，也能安全地被客户端列表使用。
 */
export type AgentRunStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AssigneeKind = "human" | "agent" | "unknown";

export type ConsoleTaskInput = {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeKind: AssigneeKind;
  dueDate: string | null;
  priority: "low" | "medium" | "high" | "urgent" | string;
  sortOrder: number;
  committedAt: Date | string | null;
  committedHandoffVersion: number | null;
  handoffVersion: number | null;
  openBlockerCount: number;
  /** 未验证冻结上下文时默认禁止启动。 */
  contextPackFrozen?: boolean;
  agentRuns: ConsoleRunInput[];
};

export type ConsoleRunInput = {
  id: string;
  status: string;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
};

export type ConsoleActor = {
  id: string;
  canReview: boolean;
  /** 由服务端按当前任务权限计算，不能用能力开关代替。 */
  canStartAgentRun?: boolean;
};

export type ConsoleCapabilities = {
  /** 当前阶段只有后端真的提供排队入口时才置 true。 */
  canStartAgentRun: boolean;
  /** 有可见的运行或运行详情入口时置 true。 */
  canViewAgentRun: boolean;
  /** 当前用户有权限查看任务证据时置 true。 */
  canViewEvidence: boolean;
};

export type TaskAction =
  | "review"
  | "view_blocker"
  | "view_run"
  | "view_error"
  | "view_evidence"
  | "start_agent"
  | "view_task";

export type TaskPriorityGroup =
  | "awaiting_review"
  | "blocked"
  | "my_active"
  | "active"
  | "todo"
  | "done";

export type TaskRowModel = ConsoleTaskInput & {
  taskStatusLabel: string;
  agentRunStatusLabel: string;
  activeRun: ConsoleRunInput | null;
  latestRun: ConsoleRunInput | null;
  priorityGroup: TaskPriorityGroup;
  primaryAction: TaskAction;
};

const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(["queued", "dispatched", "running"]);

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  review: "待验收",
  done: "已完成",
};

const AGENT_RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: "排队中",
  dispatched: "已派发",
  running: "运行中",
  completed: "执行完成",
  failed: "失败",
  cancelled: "已取消",
};

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const GROUP_WEIGHT: Record<TaskPriorityGroup, number> = {
  awaiting_review: 0,
  blocked: 1,
  my_active: 2,
  active: 3,
  todo: 4,
  done: 5,
};

function timestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isActiveRun(status: string): status is AgentRunStatus {
  return ACTIVE_RUN_STATUSES.has(status as AgentRunStatus);
}

/**
 * 同一个任务只显示一条当前运行，但不丢掉历史运行。
 * 活动运行优先，其次按创建时间倒序；时间相同用 id 固定排序，避免页面抖动。
 */
export function sortTaskRuns(runs: ConsoleRunInput[]): ConsoleRunInput[] {
  return [...runs].sort((left, right) => {
    const activeDelta = Number(isActiveRun(right.status)) - Number(isActiveRun(left.status));
    if (activeDelta !== 0) return activeDelta;
    const createdDelta = timestamp(right.createdAt) - timestamp(left.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return left.id.localeCompare(right.id);
  });
}

function latestRun(task: ConsoleTaskInput): ConsoleRunInput | null {
  return sortTaskRuns(task.agentRuns)[0] ?? null;
}

function activeRun(task: ConsoleTaskInput): ConsoleRunInput | null {
  return sortTaskRuns(task.agentRuns).find((run) => isActiveRun(run.status)) ?? null;
}

function hasCommittedContract(task: ConsoleTaskInput): boolean {
  return (
    task.committedAt !== null &&
    task.committedHandoffVersion !== null &&
    task.handoffVersion !== null &&
    task.committedHandoffVersion === task.handoffVersion
  );
}

/**
 * 顺序对应页面上的行动优先级，不能按颜色或 Agent 状态偷偷重排：
 * 待我验收 → 有阻塞 → 我的进行中 → 其他进行中 → 待办 → 已完成。
 */
export function taskPriorityGroup(task: ConsoleTaskInput, actor: ConsoleActor): TaskPriorityGroup {
  if (task.status === "review" && actor.canReview) return "awaiting_review";
  if (task.status === "done") return "done";
  if (task.openBlockerCount > 0) return "blocked";
  if (!activeRun(task) && latestRun(task)?.status === "failed") return "blocked";
  if (task.status === "doing" && task.assigneeId === actor.id) return "my_active";
  if (task.status === "doing") return "active";
  if (task.status === "done") return "done";
  return "todo";
}

/** 只根据真实数据决定动作，不因为“看起来应该有”而显示继续/重跑。 */
export function taskPrimaryAction(
  task: ConsoleTaskInput,
  actor: ConsoleActor,
  capabilities: ConsoleCapabilities,
): TaskAction {
  if (!Object.hasOwn(TASK_STATUS_LABEL, task.status)) return "view_task";
  if (task.status === "review" && actor.canReview) return "review";
  if (task.openBlockerCount > 0) return "view_blocker";

  const current = activeRun(task);
  if (current && capabilities.canViewAgentRun) return "view_run";

  const latest = latestRun(task);
  if (!current && latest?.status === "failed" && capabilities.canViewAgentRun) return "view_error";
  if (latest?.status === "completed" && capabilities.canViewEvidence) return "view_evidence";
  if (
    !current && capabilities.canStartAgentRun && actor.canStartAgentRun === true &&
    task.assigneeKind === "agent" && task.assigneeId !== null &&
    (task.status === "todo" || task.status === "doing") &&
    task.contextPackFrozen === true && hasCommittedContract(task)
  ) return "start_agent";
  return "view_task";
}

function firstRunLabel(runs: ConsoleRunInput[]): string {
  const current = sortTaskRuns(runs).find((run) => isActiveRun(run.status));
  if (current) return AGENT_RUN_STATUS_LABEL[current.status as AgentRunStatus] ?? "未知状态";
  const latest = sortTaskRuns(runs)[0];
  if (!latest) return "暂无执行记录";
  return agentRunStatusLabel(latest.status);
}

/** 将一条任务原始投影成列表所需模型；不会修改输入，也不会写数据库。 */
export function toTaskRowModel(
  task: ConsoleTaskInput,
  actor: ConsoleActor,
  capabilities: ConsoleCapabilities,
): TaskRowModel {
  const sortedRuns = sortTaskRuns(task.agentRuns);
  const current = sortedRuns.find((run) => isActiveRun(run.status)) ?? null;
  return {
    ...task,
    taskStatusLabel: taskStatusLabel(task.status),
    agentRunStatusLabel: firstRunLabel(task.agentRuns),
    activeRun: current,
    latestRun: sortedRuns[0] ?? null,
    priorityGroup: taskPriorityGroup(task, actor),
    primaryAction: taskPrimaryAction(task, actor, capabilities),
  };
}

/** 先按行动组，再按优先级、排序值和 id，保证结果可预测。 */
export function sortTaskRows(rows: TaskRowModel[]): TaskRowModel[] {
  return [...rows].sort((left, right) => {
    const groupDelta = GROUP_WEIGHT[left.priorityGroup] - GROUP_WEIGHT[right.priorityGroup];
    if (groupDelta !== 0) return groupDelta;
    const priorityDelta =
      (PRIORITY_WEIGHT[right.priority] ?? 0) - (PRIORITY_WEIGHT[left.priority] ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    const sortDelta = left.sortOrder - right.sortOrder;
    if (sortDelta !== 0) return sortDelta;
    return left.id.localeCompare(right.id);
  });
}

export function taskStatusLabel(status: string): string {
  return Object.hasOwn(TASK_STATUS_LABEL, status) ? TASK_STATUS_LABEL[status as TaskStatus] : "未知状态";
}

export function agentRunStatusLabel(status: string): string {
  return Object.hasOwn(AGENT_RUN_STATUS_LABEL, status) ? AGENT_RUN_STATUS_LABEL[status as AgentRunStatus] : "未知状态";
}
