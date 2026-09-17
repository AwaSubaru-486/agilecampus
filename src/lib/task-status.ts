// 任务状态的单一真相源。
//
// 刻意不反向依赖 @/db/schema：schema 引 drizzle-orm/pg-core，而本模块被客户端组件
// （看板 board.tsx / board-columns.ts、任务卡）引用，取之会把整个 ORM 拖进浏览器包。
// 故依赖方向相反——此处定义，schema.ts 的 pgEnum 由此派生。仍是单一真相源，只是根在这头。
// 枚举顺序即看板列顺序。
export const TASK_STATUSES = ["todo", "doing", "done"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEFAULT_STATUS: TaskStatus = "todo";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

// 看板列/甘特条的语义色 class；色值定义见 globals.css 的 @theme。
export const STATUS_TONE: Record<TaskStatus, string> = {
  todo: "text-todo",
  doing: "text-doing",
  done: "text-done",
};

// 宽松版取词：UI 侧多处把 status 收成 string，用此兜住未知值，免得到处断言。
export function statusLabel(status: string): string {
  return STATUS_LABEL[status as TaskStatus] ?? status;
}

// 零值桶。切莫写 { todo: 0, doing: 0, done: 0 } 字面量——
// project.ts 的 byStatus 曾如此，加档后未知键自增不报错、taskTotal 仍只加字面量那三项，
// 任务总数凭空少算、进度虚高，且编译器一声不吭。故取桶一律走此处。
export function emptyByStatus(): Record<TaskStatus, number> {
  return Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
}

// 四个谓词各司其职，勿合并成一个 isClosed：
// 「已完成」与「不可再逾期」在引入验收档后不再是同一件事。
// 参数取 string 而非 TaskStatus——调用点多在 UI 投影（status: string）处，宽收窄用。

/** 已交付。进度分子、完成数、完成通知的口径。 */
export function isCompleted(status: string): boolean {
  return status === "done";
}

/** 已终结：不再计入逾期、无人负责等风险。今与 isCompleted 同义，
 *  但语义独立保留——日后若加 cancelled 档，取消的任务不该被算作完成。 */
export function isTerminal(status: string): boolean {
  return status === "done";
}

/** 未终结，仍是风险扫描的对象。 */
export function isActive(status: string): boolean {
  return !isTerminal(status);
}

/** 在办：人还攥在手里的活。成员负荷与「待承诺」的口径——
 *  任务一旦交出去待验收，负责人肩上就不该再计它。 */
export function isInFlight(status: string): boolean {
  return status === "todo" || status === "doing";
}
