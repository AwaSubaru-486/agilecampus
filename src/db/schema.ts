import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
  date,
  doublePrecision,
  integer,
  boolean,
  index,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
// 状态值取自 lib/task-status.ts（零依赖叶子模块），使看板等客户端组件无需引 schema 即可复用。
// 依赖方向：db/schema → lib/task-status。仍是单一真相源。
import { DEFAULT_STATUS, TASK_STATUSES } from "@/lib/task-status";
import { BLOCKER_REASONS, BLOCKER_STATUSES } from "@/lib/blocker-labels";
import { ENTRY_TYPES } from "@/lib/entry-labels";

export const teamRoleEnum = pgEnum("team_role", ["admin", "teacher", "student"]);
export type TeamRole = (typeof teamRoleEnum.enumValues)[number];

// 团队成员的两类身份：人，与 AI agent。
//
// 让 agent 成为 users 的一行，是本项目一个刻意的取舍。
// 参照 Multica（github.com/multica-ai/multica，其 issue 表用
// assignee_type ∈ (member, agent) + 无外键的 assignee_id），
// 我们不走多态，而是共用同一张表——好处是 tasks.assigneeId、
// activity_events.actorId、blockers.raisedById 三处既有外键一字不改就能指向 agent，
// 引用完整性也不必放弃；代价是 users 要容纳「不能登录的身份」（passwordHash 可空）。
export const userKindEnum = pgEnum("user_kind", ["human", "agent"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // agent 用合成的 agent-<uuid>@agents.local 占位，以满足唯一约束；
  // 它没有密码，登不进来
  email: text("email").notNull().unique(),
  // 可空：agent 无密码，也就无法登录。登录入口须显式拒绝 kind = 'agent'
  passwordHash: text("password_hash"),
  kind: userKindEnum("kind").notNull().default("human"),
  name: text("name").notNull(),
  // 飞书绑定（一对一，可空=未绑定）：open_id 为应用内用户唯一标识，发私信用之
  feishuOpenId: text("feishu_open_id").unique(),
  feishuName: text("feishu_name"),
  feishuBoundAt: timestamp("feishu_bound_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("student"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_members_team_user_unique").on(t.teamId, t.userId)],
);

export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const milestoneStatusEnum = pgEnum("milestone_status", ["open", "done"]);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high"]);
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("projects_team_idx").on(t.teamId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    targetDate: date("target_date"),
    status: milestoneStatusEnum("status").notNull().default("open"),
    // 实际达成时刻。与 targetDate（计划）分开记：
    // 计划哪天到、实际哪天到，两者之差本身就是复盘要看的东西。
    achievedAt: timestamp("achieved_at"),
    // 达成那一刻自动生成的实况摘要，冻结下来。
    // 与活动流同样的理由：事后再去推算，任务早改了名、人早换了岗。
    autoSummary: text("auto_summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

// 里程碑上的高光时刻——这块「功勋墙」是自动长出来的，一格不用人填。
//
// 由来：里程碑原本是人工设的检查点，谁去填、什么时候填，全凭自觉。
// 于是它要么空着，要么沦为事后补记。改成从既有数据自动提取：
// 一件事做得艰难（返工过、超了预估、卡过）、或由 AI 交付，
// 达成时就在里程碑上留一笔。人什么都不用做，痕迹自己在那儿。
// 曾经还有一条 over_estimate（实际耗时超出预估），写出来又删了：
// 它拿「认领到交付的挂钟时间」当「实际投入」，而任务在那儿放着七天
// 不等于干了七天。贡献记录里我明明把「实际投入时长」列为**量不到**的维度，
// 此处却又拿它当规则——自相矛盾。做得费不费劲本已由返工、卡过、逾期三条覆盖。
export const highlightKindEnum = pgEnum("highlight_kind", [
  "delivered_by_agent", // 由 AI 交付
  "reworked", // 经过返工
  "unblocked", // 卡过之后被解决
  "late_done", // 逾期完成
  "first_delivery", // 该项目的第一件交付
]);
export type HighlightKind = (typeof highlightKindEnum.enumValues)[number];

export const milestoneHighlights = pgTable(
  "milestone_highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id, { onDelete: "cascade" }),
    // 任务删了，高光仍留着——复盘看的是「当时干成过什么」
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    kind: highlightKindEnum("kind").notNull(),
    // 冻结的中文一句话，人直接读
    note: text("note").notNull(),
    // 谁做的（人还是 agent，看 users.kind）
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("milestone_highlights_milestone_idx").on(t.milestoneId, t.createdAt),
    // 同一任务同一类高光只记一次——反复达成/退回不该刷屏
    uniqueIndex("milestone_highlights_unique").on(t.milestoneId, t.taskId, t.kind),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    // 子任务层级：自引用，空＝顶层任务。父任务删则子任务随之（cascade）。
    // 自引用外键须显式标注 AnyPgColumn，否则 TS 推断成环。
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    // 交接契约：把「派活」从一句标题变成可执行、可验收的最小协议。
    handoffBrief: text("handoff_brief"),
    doneCriteria: jsonb("done_criteria"),
    requiredEvidence: jsonb("required_evidence"),
    responseDueAt: timestamp("response_due_at"),
    // 受 context-pack 依赖声明顺序影响，归属与 frozen 状态由领域层校验。
    contextPackId: uuid("context_pack_id"),
    completionNote: text("completion_note"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    status: taskStatusEnum("status").notNull().default(DEFAULT_STATUS),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),

    // --- 任务承诺：认领时由负责人填写，作为「他答应做什么」的基准 ---
    // commitmentNote 是「我打算怎么做」的一句话计划，不是任务说明：
    // description 由派活的人写，commitmentNote 由接活的人写，二者常不同。
    commitmentNote: text("commitment_note"),
    committedAt: timestamp("committed_at"),
    estimatedHours: doublePrecision("estimated_hours"),

    // --- 提交与验收 ---
    submittedAt: timestamp("submitted_at"),
    reviewedAt: timestamp("reviewed_at"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewNote: text("review_note"),
    // 被退回次数。贡献记录里「返工成本」一维的唯一来源，也是验收质量的逆向代理指标。
    rejectCount: integer("reject_count").notNull().default(0),

    // --- 接住 / 接不住 ---
    // 活被派下来，接不住的人（或 agent）当场说得出口，比拖到 deadline 才暴露便宜得多。
    // 人机混合团队里这条边更关键：agent 接不住时会静默失败，那比人不吭声更难发现。
    // 「待回应」不另设状态位——assigneeId 非空而 committedAt 为空即是，
    // 由 isAwaitingResponse() 推出，状态机不必再多一档。
    declineReason: text("decline_reason"),
    declinedAt: timestamp("declined_at"),
    declinedById: uuid("declined_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_parent_idx").on(t.parentTaskId),
  ],
);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "tool"]);
export type MessageRole = (typeof messageRoleEnum.enumValues)[number];

export const conversationVisibilityEnum = pgEnum("conversation_visibility", [
  "private",
  "project",
]);
export type ConversationVisibility = (typeof conversationVisibilityEnum.enumValues)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    parentConversationId: uuid("parent_conversation_id").references(
      (): AnyPgColumn => conversations.id,
      { onDelete: "set null" },
    ),
    // 指向源会话中作为分叉边界的消息。消息表定义在后，外键关系由业务层校验，
    // 避免 schema 初始化时形成 conversations <-> messages 的循环定义。
    forkedFromMessageId: uuid("forked_from_message_id"),
    visibility: conversationVisibilityEnum("visibility").notNull().default("project"),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversations_project_idx").on(t.projectId),
    index("conversations_creator_idx").on(t.createdById),
    index("conversations_task_idx").on(t.taskId),
    index("conversations_parent_idx").on(t.parentConversationId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // 记录这一轮模型实际读取的冻结上下文。因 contextPacks 在本文件后段声明，
    // 这里先保留 uuid 字段，领域层负责校验归属与 frozen 状态。
    contextPackId: uuid("context_pack_id"),
    // 分支会话复制消息时保留来源，便于展示和审计上下文继承范围。
    sourceMessageId: uuid("source_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_context_pack_idx").on(t.contextPackId),
    index("messages_source_idx").on(t.sourceMessageId),
  ],
);

// AI 协作上下文的可复现快照。它不是「把聊天再塞进 prompt」：
// pack 明确列出模型能看到的项目事实，并在冻结后保持不可变。
export const contextPackStatusEnum = pgEnum("context_pack_status", [
  "draft",
  "frozen",
  "superseded",
]);
export type ContextPackStatus = (typeof contextPackStatusEnum.enumValues)[number];

export const contextSourceTypeEnum = pgEnum("context_source_type", [
  "project",
  "milestone",
  "task",
  "blocker",
  "entry",
  "decision",
  "conversation",
  "message",
  "activity_window",
  "manual",
]);
export type ContextSourceType = (typeof contextSourceTypeEnum.enumValues)[number];

export const contextPacks = pgTable(
  "context_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: contextPackStatusEnum("status").notNull().default("draft"),
    summary: text("summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    frozenAt: timestamp("frozen_at"),
  },
  (t) => [
    index("context_packs_project_idx").on(t.projectId, t.createdAt),
    index("context_packs_conversation_idx").on(t.conversationId),
    index("context_packs_task_idx").on(t.taskId),
    index("context_packs_creator_idx").on(t.createdById),
  ],
);

export const contextPackItems = pgTable(
  "context_pack_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => contextPacks.id, { onDelete: "cascade" }),
    sourceType: contextSourceTypeEnum("source_type").notNull(),
    sourceId: uuid("source_id"),
    label: text("label").notNull(),
    // 快照只保存经过领域层裁剪后的字段，不保存 token、密码或隐藏 prompt。
    snapshot: jsonb("snapshot").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at"),
    included: boolean("included").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("context_pack_items_pack_idx").on(t.packId, t.position),
    index("context_pack_items_source_idx").on(t.sourceType, t.sourceId),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predecessorId: uuid("predecessor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorId: uuid("successor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("task_dep_pair_unique").on(t.predecessorId, t.successorId),
    index("task_dep_predecessor_idx").on(t.predecessorId),
  ],
);

// Personal API Token：CC 等浏览器外调用的认证凭据。
// 明文只生成时返回一次，库中仅存 sha256 hash（高熵 token 无需 bcrypt，且 hash 可建唯一索引供 O(1) 查验）。
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

// 资源占用登记：团队共享资源（服务器/算力等）的占用记录，纯登记无审批。
// endTime 可空=占用中；时长 = endTime - startTime（结束后计算）。
export const resourceUsages = pgTable(
  "resource_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceName: text("resource_name").notNull(),
    purpose: text("purpose"),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("resource_usages_team_idx").on(t.teamId),
    index("resource_usages_user_idx").on(t.userId),
  ],
);

export const labelColorEnum = pgEnum("label_color", [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
]);
export type LabelColor = (typeof labelColorEnum.enumValues)[number];

// 标签挂在团队而非项目：实验室内项目多且同质，共享一套免去每建一项目重建之苦。
// 唯一索引建在普通两列，大小写不敏感去重由 lib/label.ts 的 lower() 查询承担。
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: labelColorEnum("color").notNull().default("slate"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labels_team_name_unique").on(t.teamId, t.name),
    index("labels_team_idx").on(t.teamId),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
);

// 取值取自 lib/blocker-labels.ts（零依赖叶子模块），使悬浮求助入口等客户端组件
// 无需引 schema 即可复用文案。依赖方向：db/schema → lib/blocker-labels。
export const blockerReasonEnum = pgEnum("blocker_reason", BLOCKER_REASONS);
export type BlockerReason = (typeof blockerReasonEnum.enumValues)[number];

export const blockerStatusEnum = pgEnum("blocker_status", BLOCKER_STATUSES);
export type BlockerStatus = (typeof blockerStatusEnum.enumValues)[number];

// 阻塞上报。三条设计要点：
//   1. taskId 可空——全局悬浮入口不强制「先找到那个任务」，
//      而人卡住时恰恰最不想先翻到任务页去
//   2. 独立成表而非给 tasks 加 blocked 状态：一件事可能同时被几样东西卡住，
//      且解除后不该在任务历史里留下状态噪声
//   3. 带 helpNeeded 自由文本：求助的关键是「说清需要什么」，
//      光标记「我卡住了」等于把问题原样抛给队友
export const blockers = pgTable(
  "blockers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // cascade 而非 set null：阻塞是一条「未了的事」，不是历史。
    // 若置空，任务删掉后会留下一个永远 open 却无所指的阻塞，健康度里再也清不掉。
    // 历史由 activity_events 保存（那里的 taskId 才是 set null），此处不必重复承载。
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    raisedById: uuid("raised_by_id").references(() => users.id, { onDelete: "set null" }),
    reason: blockerReasonEnum("reason").notNull(),
    detail: text("detail"),
    helpNeeded: text("help_needed"),
    status: blockerStatusEnum("status").notNull().default("open"),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("blockers_project_status_idx").on(t.projectId, t.status),
    index("blockers_task_idx").on(t.taskId),
    index("blockers_raised_by_idx").on(t.raisedById),
    // 跨项目「待我帮忙」页按状态扫全库未解决者
    index("blockers_status_time_idx").on(t.status, t.createdAt),
  ],
);

// 协作邀请：记下推荐了谁、推荐时的分数与理由。
// 存分数与理由不是为了算账，而是为了在可用性测试里回答「推荐准不准」——
// 这是本项目少数能拿数据说话的交互决策之一。
export const blockerInvites = pgTable(
  "blocker_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => blockers.id, { onDelete: "cascade" }),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
    score: doublePrecision("score"),
    reasons: jsonb("reasons"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("blocker_invites_unique").on(t.blockerId, t.inviteeId),
    index("blocker_invites_invitee_idx").on(t.inviteeId),
  ],
);

// 活动流事件类型。
// 一次定义齐（含尚未来到的承诺/验收/阻塞各档）：Postgres 枚举加值是迁移风险点，
// 与其每图 ALTER TYPE 一次，不如一次到位。当前已用的是前七种，其余随各图启用。
export const activityTypeEnum = pgEnum("activity_type", [
  // 任务基础变更（当前在用）
  "task_created",
  "task_updated",
  "task_status_changed",
  "task_assigned",
  "task_deleted",
  "task_labeled",
  "task_dependency_changed",
  // 项目与里程碑
  "milestone_created",
  "project_created",
  "project_updated",
  // 项目档案：老师反馈、文档、成果链接
  "entry_created",
  "entry_deleted",
  // 承诺与验收（启用待「任务承诺与验收」一图）
  "task_claimed",
  "task_committed",
  "task_declined",
  "task_submitted",
  "task_accepted",
  "task_rejected",
  "task_reopened",
  // 阻塞与协作邀请（启用待「阻塞上报」一图）
  "blocker_raised",
  "blocker_invited",
  "blocker_resolved",
  "blocker_cancelled",
]);
export type ActivityType = (typeof activityTypeEnum.enumValues)[number];

// 项目活动流：append-only，只插不改不删，是「谁在何时对什么做了什么」的唯一真相源。
// 派生物（时间线 / 贡献记录 / 复盘材料）皆由它算出，故贡献记录无需任何人手工填写。
//
// 为何独立建表而不复用 messages：
//   1. 过半写路径没有会话——拖拽改状态、编辑弹窗改负责人、CC 经 API 建任务、cron 提醒，
//      而 messages.conversationId 非空，要记这些就得给每个项目造「系统会话」，现有代码无此概念
//   2. 贡献聚合需可 groupBy 的类型列；messages 只有 role 与自由文本，从中解析语义是脆的
//   3. 会话分叉会复制消息，事件若住在 messages 里，每 fork 一次贡献数字就翻一份
//   4. 会话可删（cascade），而复盘材料必须比聊天记录活得久
//   5. AI 会话有 private 档，私人会话的工具调用进入项目活动流即是隐私泄漏
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // set null 而非 cascade：任务被删，历史仍在——复盘恰要能看到「删过什么」
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: activityTypeEnum("type").notNull(),
    // 冗余中文摘要，连同 payload 冻结当时的任务标题与人名。
    // 两处理由：(a) 复盘要看「当时叫什么」，任务改名后 join 出的新名是年代错乱；
    // (b) 时间线是最高频读面，冻结后整个渲染是单表查询，无需按 taskId 扇出 join。
    summary: text("summary"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("activity_project_time_idx").on(t.projectId, t.createdAt),
    index("activity_task_idx").on(t.taskId, t.createdAt),
    index("activity_actor_idx").on(t.actorId, t.createdAt),
    index("activity_project_type_idx").on(t.projectId, t.type),
  ],
);

// ============ 项目档案 ============
//
// 一张表承载老师反馈、文档、成果链接三种东西。
//
// 为什么合成一张表而不是各建各的：需求文档开篇的痛点原话是
// 「成果散落在不同工具中，难以形成完整的项目档案和可复用的过程资产」。
// 分三张表就是把同一句话在数据库里再演一遍。合起来之后，
// 「这个项目的全部过程资产」是一次查询，档案导出也不必拼三路。
//
// 三者的差别只在 type 与少数字段（链接有 url，其余没有），
// 不足以支撑三张表。日后加「周报」「会议纪要」也只是加一个枚举值。
// 取值取自 lib/entry-labels.ts（零依赖叶子模块），
// 使档案区等客户端组件无需引 schema 即可复用文案。
export const entryTypeEnum = pgEnum("project_entry_type", ENTRY_TYPES);
export type EntryType = (typeof entryTypeEnum.enumValues)[number];

export const projectEntries = pgTable(
  "project_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // 可挂在具体任务上。反馈常针对某件事，文档与链接则未必
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    type: entryTypeEnum("type").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    // 只有 deliverable 用得上。不另建表——一个可空字段比一张一对一表便宜得多
    url: text("url"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_entries_project_idx").on(t.projectId, t.createdAt),
    index("project_entries_task_idx").on(t.taskId),
    index("project_entries_type_idx").on(t.projectId, t.type),
  ],
);

// ============ AI agent 作为一等团队成员 ============

// agent 的实时状态。blocked 是一等公民——
// 「agent 卡住了会举手」正是本项目要解决的事，而举手走的是既有的求助机制。
// offline 与 error 分开：前者是「没开着」，后者是「开着但出错了」，
// 界面上该说的话完全不同。
export const agentStatusEnum = pgEnum("agent_status", [
  "idle",
  "working",
  "blocked",
  "error",
  "offline",
]);
export type AgentStatus = (typeof agentStatusEnum.enumValues)[number];

export const agentRuntimeEnum = pgEnum("agent_runtime", ["local", "cloud"]);
export type AgentRuntime = (typeof agentRuntimeEnum.enumValues)[number];

// agent 的扩展资料。身份（姓名、头像、所属团队）在 users / team_members 里，
// 此处只存「作为 agent 才需要」的那部分。
export const agents = pgTable(
  "agents",
  {
    // 与 users 一对一。agent 也是团队成员，故同样挂在 teamId 上，
    // 权限校验与人的口径一致（requireTeamRole 不必为它开特例）。
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // 跑在什么上：claude-code / codex / cursor / custom。
    // 存字符串而非枚举：新的 agent CLI 层出不穷，加一档不该要一次迁移。
    provider: text("provider").notNull(),
    runtime: agentRuntimeEnum("runtime").notNull().default("local"),
    // 会做什么。派活时据以推荐，也是它的「简历」。
    // 用 text[] 而非 jsonb：要按能力筛人，数组能直接建 GIN 索引。
    capabilities: text("capabilities")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    status: agentStatusEnum("status").notNull().default("offline"),
    // 同时能跑几个任务。派活时与在办数比较，满了就不再往下压。
    maxConcurrent: integer("max_concurrent").notNull().default(1),
    // 谁养的它。学生自己注册的 agent 归他，出问题找得到人。
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    // 心跳。判在不在线看它，不额外存 boolean。
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("agents_team_idx").on(t.teamId),
    index("agents_status_idx").on(t.teamId, t.status),
  ],
);

// 一次派给 agent 的执行记录。
//
// 状态刻意与任务状态分开：任务是「这件事做完了没有」，
// run 是「这一趟 agent 跑成没跑成」。同一件事可以跑好几趟
// ——失败重试、换一个 agent 再试——而任务始终只有一个。
export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "dispatched",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentRunStatus = (typeof agentRunStatusEnum.enumValues)[number];

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.userId, { onDelete: "cascade" }),
    // 任务删了，跑过的事实可以留着（复盘要看「AI 在这上面试过几趟」），
    // 但已无从指认，故 set null 而非 cascade
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    status: agentRunStatusEnum("status").notNull().default("queued"),
    // 同时排队的多个任务，谁先跑
    priority: integer("priority").notNull().default(0),
    dispatchedAt: timestamp("dispatched_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    // agent 回报的产物：改了什么文件、产出什么、跑到哪一步
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // 排队取活走这条：同一 agent 下，按优先级降序、创建升序
    index("agent_runs_queue_idx").on(t.agentId, t.priority, t.createdAt),
    index("agent_runs_task_idx").on(t.taskId),
    index("agent_runs_status_idx").on(t.status, t.createdAt),
  ],
);
