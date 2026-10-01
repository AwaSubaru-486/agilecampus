/**
 * 协同执行台 URL 归一化规则。
 *
 * 纯函数：不依赖 router、数据库或 React。
 * 所有路由决策在这里集中，组件只负责读结果、推跳转。
 *
 * 规范化表（工单 W01）：
 *   缺省/非法 space → space=work
 *   space=live     → space=work，保留合法筛选与关联参数
 *   space=work     → 协同执行（默认）
 *   space=studio   → 同一执行台的 Agent 视图
 *   space=record   → 成果记录
 *   非空 conversation/approval → space=studio
 *
 * 点击任务时：保留筛选参数，清除旧的 run/conversation/approval 及其游标。
 * task= 只用于查看详情；编辑由明确"编辑"按钮控制，不由 task= 触发。
 */

import { type ProjectSpace, PROJECT_SPACES } from "./project-space";

export type ConsoleParams = {
  space?: string | null;
  task?: string | null;
  conversation?: string | null;
  approval?: string | null;
  run?: string | null;
  panel?: string | null;
  /** 工作模式下的筛选参数 */
  assignee?: string | null;
  priority?: string | null;
  label?: string | null;
  milestone?: string | null;
  overdue?: string | null;
  group?: string | null;
};

export type NormalizedConsoleParams = {
  space: ProjectSpace;
  task: string | null;
  conversation: string | null;
  approval: string | null;
  run: string | null;
  panel: string | null;
  assignee: string | null;
  priority: string | null;
  label: string | null;
  milestone: string | null;
  overdue: string | null;
  group: string | null;
};

const VALID_SPACES: Set<string> = new Set(PROJECT_SPACES);

function pickFirst(value: string | string[] | null | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isLegalSpace(s: string | null | undefined): s is ProjectSpace {
  return !!s && VALID_SPACES.has(s);
}

/**
 * 从原始 searchParams 对象（Next.js 服务端）规范化所有参数。
 * 幂等：重复调用结果不变，不产生重定向循环。
 */
export function normalizeConsoleParams(raw: ConsoleParams): NormalizedConsoleParams {
  const space = pickFirst(raw.space);
  const conversation = pickFirst(raw.conversation);
  const approval = pickFirst(raw.approval);
  const task = pickFirst(raw.task);
  const run = pickFirst(raw.run);
  const panel = pickFirst(raw.panel);
  const assignee = pickFirst(raw.assignee);
  const priority = pickFirst(raw.priority);
  const label = pickFirst(raw.label);
  const milestone = pickFirst(raw.milestone);
  const overdue = pickFirst(raw.overdue);
  const group = pickFirst(raw.group);

  // 带 conversation 或 approval 强制落 studio
  let resolvedSpace: ProjectSpace;
  if (conversation || approval) {
    resolvedSpace = "studio";
  } else if (!space || !isLegalSpace(space) || space === "live") {
    // live 归一化为 work（协同执行是新默认）
    resolvedSpace = "work";
  } else {
    resolvedSpace = space;
  }

  return {
    space: resolvedSpace,
    task,
    conversation,
    approval,
    run,
    panel,
    assignee,
    priority,
    label,
    milestone,
    overdue,
    group,
  };
}

/**
 * 判断是否需要服务端 redirect（URL 与规范化结果不一致）。
 */
export function needsRedirect(raw: ConsoleParams, normalized: NormalizedConsoleParams): boolean {
  const rawSpace = pickFirst(raw.space);
  if (rawSpace !== normalized.space) return true;
  // conversation/approval 已被 spaceForConversationParams 在老逻辑中处理，
  // 此函数只判断 space 差异足够触发 redirect
  return false;
}

/**
 * 构造选中任务的 URL（使用 push，保留筛选参数，清除旧关联）。
 *
 * 切换任务时清除 run / conversation / approval 及其游标，
 * 避免 A 任务的 run 残留到 B 任务的视图里。
 */
export function buildSelectTaskHref(
  projectId: string,
  taskId: string,
  current: NormalizedConsoleParams,
): string {
  const qs = new URLSearchParams();
  qs.set("space", current.space === "studio" ? "work" : current.space);
  qs.set("task", taskId);
  // 保留筛选参数
  if (current.assignee) qs.set("assignee", current.assignee);
  if (current.priority) qs.set("priority", current.priority);
  if (current.label) qs.set("label", current.label);
  if (current.milestone) qs.set("milestone", current.milestone);
  if (current.overdue) qs.set("overdue", current.overdue);
  if (current.group) qs.set("group", current.group);
  // run / conversation / approval 不继承
  return `/projects/${projectId}?${qs.toString()}`;
}

/**
 * 构造清除当前任务选中的 URL（回到列表）。
 */
export function buildClearTaskHref(
  projectId: string,
  current: NormalizedConsoleParams,
): string {
  const qs = new URLSearchParams();
  qs.set("space", current.space === "studio" ? "work" : current.space);
  if (current.assignee) qs.set("assignee", current.assignee);
  if (current.priority) qs.set("priority", current.priority);
  if (current.label) qs.set("label", current.label);
  if (current.milestone) qs.set("milestone", current.milestone);
  if (current.overdue) qs.set("overdue", current.overdue);
  if (current.group) qs.set("group", current.group);
  return `/projects/${projectId}?${qs.toString()}`;
}

/**
 * 从 NormalizedConsoleParams 序列化为 URLSearchParams 字符串（用于 redirect）。
 */
export function serializeConsoleParams(p: NormalizedConsoleParams): string {
  const qs = new URLSearchParams();
  qs.set("space", p.space);
  if (p.task) qs.set("task", p.task);
  if (p.conversation) qs.set("conversation", p.conversation);
  if (p.approval) qs.set("approval", p.approval);
  if (p.run) qs.set("run", p.run);
  if (p.panel) qs.set("panel", p.panel);
  if (p.assignee) qs.set("assignee", p.assignee);
  if (p.priority) qs.set("priority", p.priority);
  if (p.label) qs.set("label", p.label);
  if (p.milestone) qs.set("milestone", p.milestone);
  if (p.overdue) qs.set("overdue", p.overdue);
  if (p.group) qs.set("group", p.group);
  return qs.toString();
}
