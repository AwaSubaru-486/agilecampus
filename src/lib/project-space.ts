// 项目四模式。术语与职责见 docs/design/product-language.md §5。
//
// 旧版项目页是一根纵向长条：概览 → 里程碑 → 看板 → 对话，什么都往下堆。
// 四模式承认**同一个项目要看的东西有四种性质**，各自需要独立的画布：
//
//   现场   谁在推进，哪里需要行动
//   工作   任务如何拆分与流转
//   协同室 人与 AI 怎样探索、比较、确认
//   记录   形成了什么成果与证据
//
// 一次只渲染一个。这不只是样式问题——四个 space 的取数彼此独立，
// 打开「现场」不该去查完整的会话历史。

export const PROJECT_SPACES = ["live", "work", "studio", "record"] as const;
export type ProjectSpace = (typeof PROJECT_SPACES)[number];

export const DEFAULT_SPACE: ProjectSpace = "live";

export const SPACE_LABEL: Record<ProjectSpace, string> = {
  live: "概览",
  work: "任务",
  studio: "Agent",
  record: "成果",
};

export const SPACE_HINT: Record<ProjectSpace, string> = {
  live: "项目进展、风险与当前接力",
  work: "任务如何拆分、交接与验收",
  studio: "人和 Agent 一起推进任务",
  record: "已交付成果、决策与证据",
};

function isProjectSpace(value: unknown): value is ProjectSpace {
  return typeof value === "string" && (PROJECT_SPACES as readonly string[]).includes(value);
}

/**
 * 从查询参数解析模式。
 *
 * 容错到底：URL 是用户能改的地方，也可能被别的系统拼错。
 * 非法值一律退回默认，不抛错——访问 `/projects/x?space=galaxy`
 * 应该看到「现场」，而不是一个 500。
 */
export function parseProjectSpace(value: unknown): ProjectSpace {
  // 同名参数出现多次时 Next 给的是数组；取第一个，与浏览器惯例一致
  const first = Array.isArray(value) ? value[0] : value;
  return isProjectSpace(first) ? first : DEFAULT_SPACE;
}

/**
 * 拼一个模式链接。
 *
 * space 显式写进 URL（含默认的 live）——四模式是并列的四个视图，
 * 让「现场」独享一个省略形式会让人以为它是「主页面」，
 * 而 V2 的立场恰恰是四者平权。
 */
export function buildSpaceHref(input: {
  projectId: string;
  space: ProjectSpace;
  taskId?: string;
  conversationId?: string;
  /** 只放入当前模式允许继承的 URL 状态，避免切换模式时把旧页面带回去。 */
  extra?: Record<string, string | undefined>;
}): string {
  const qs = new URLSearchParams();
  qs.set("space", input.space);
  if (input.taskId) qs.set("task", input.taskId);
  if (input.conversationId) qs.set("conversation", input.conversationId);
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (value && !qs.has(key)) qs.set(key, value);
  }
  return `/projects/${input.projectId}?${qs.toString()}`;
}

/** 某模式是否承载 `task=` 抽屉。四种模式都可以——任务抽屉是全局叠加层。 */
export const SPACE_SUPPORTS_TASK_DRAWER = true;

/**
 * `conversation=` 只在协同室生效。
 *
 * 带着会话 ID 落到别的模式时，应当跳转过去而不是静默忽略——
 * 静默忽略会让「点了一条会话链接却停在现场」变成一桩悬案。
 */
export function spaceForConversationParams(space: ProjectSpace, hasConversation: boolean): ProjectSpace {
  return hasConversation ? "studio" : space;
}
