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
  index,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// 状态值取自 lib/task-status.ts（零依赖叶子模块），使看板等客户端组件无需引 schema 即可复用。
// 依赖方向：db/schema → lib/task-status。仍是单一真相源。
import { DEFAULT_STATUS, TASK_STATUSES } from "@/lib/task-status";

export const teamRoleEnum = pgEnum("team_role", ["admin", "teacher", "student"]);
export type TeamRole = (typeof teamRoleEnum.enumValues)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
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
    // 分支会话复制消息时保留来源，便于展示和审计上下文继承范围。
    sourceMessageId: uuid("source_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_source_idx").on(t.sourceMessageId),
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
  // 承诺与验收（启用待「任务承诺与验收」一图）
  "task_claimed",
  "task_committed",
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
