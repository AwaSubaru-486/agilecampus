// 类型导入，编译后擦除，不会把 drizzle 拖进客户端包
import type { TeamRole } from "@/db/schema";
import { AppError } from "./errors";

// 任务状态的单一真相源。
//
// 刻意不反向依赖 @/db/schema：schema 引 drizzle-orm/pg-core，而本模块被客户端组件
// （看板 board.tsx / board-columns.ts、任务卡）引用，取之会把整个 ORM 拖进浏览器包。
// 故依赖方向相反——此处定义，schema.ts 的 pgEnum 由此派生。仍是单一真相源，只是根在这头。
// 枚举顺序即看板列顺序。
// 「验收中」一档的用意：学生做完不能自证完成，只推得动到此处；
// 由组长或教师判过之后才落 done。看板因此多一列，而「完成」这件事第一次有了把关人。
export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEFAULT_STATUS: TaskStatus = "todo";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  review: "待验收",
  done: "已完成",
};

// 看板列/甘特条的语义色 class；色值定义见 globals.css 的 @theme。
// review 刻意取紫而非琥珀——琥珀已被 --color-medium 占作中优先级，同色则两义相混。
export const STATUS_TONE: Record<TaskStatus, string> = {
  todo: "text-todo",
  doing: "text-doing",
  review: "text-review",
  done: "text-done",
};

// 状态转移表。只有一条业务铁律：**学生不能自证完成**——
// 其余边皆为「允许」而非「应该」，宽松以容纳真实协作中的反复（做完又发现没做完、被退回等）。
export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["doing", "review"],
  doing: ["todo", "review"],
  review: ["doing", "done"],
  done: ["doing"], // 重开：既有看板本就能拖回，保留能力但记一笔事件
};

// 能否从 from 走到 to。role 取项目角色（teamRoleEnum），非任务关系。
export function canTransition(from: TaskStatus, to: TaskStatus, role: TeamRole): boolean {
  if (from === to) return true;
  // 组长与教师是验收人，判完成不受转移表约束——他自己就是那个「通过」的动作。
  // 少了这一支，管理员也无法把任务推到已完成（转移表里根本没有通往 done 的边）。
  if (to === "done" && (role === "admin" || role === "teacher")) return true;
  // 学生不得自证完成——这是「任务承诺与验收」得以成立的那条边
  if (to === "done") return false;
  return TRANSITIONS[from].includes(to);
}

// 落库前的守卫。文案会直接出现在看板拖拽失败的提示里，故须是给人看的话。
export function assertTransition(from: TaskStatus, to: TaskStatus, role: TeamRole): void {
  if (canTransition(from, to, role)) return;
  if (to === "done" && from !== "done") {
    throw new AppError("任务须先提交验收，由组长或教师通过后才能标记完成");
  }
  throw new AppError(`不能将任务由${STATUS_LABEL[from]}改为${STATUS_LABEL[to]}`);
}

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

/** 待验收：活已交出，等组长或教师判。 */
export function isInReview(status: string): boolean {
  return status === "review";
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
