import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { users, projects, tasks } from "./schema";

export type CheckpointMaterial = {
  id: string;
  kind: "context" | "transcript" | "patch" | "other";
  sha256: string;
  byteLength: number;
  transferred: boolean;
};

export type CheckpointSource = {
  provider: string;
  providerVersion: string;
  captureMode: "native" | "context-only";
};

export type CheckpointSummary = {
  goal: string;
  completed: string[];
  remaining: string[];
  blocker: string | null;
  nextAction: string;
};

export const checkpointIndices = pgTable(
  "checkpoint_indices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visibility: text("visibility").notNull().default("project"), // "project" | "assignee"
    parentCheckpointId: uuid("parent_checkpoint_id"),
    taskHandoffVersion: integer("task_handoff_version").notNull(),
    taskUpdatedAt: timestamp("task_updated_at").notNull(),
    repositoryKeyHash: text("repository_key_hash").notNull(),
    headSha: text("head_sha").notNull(),
    source: jsonb("source").$type<CheckpointSource>().notNull(),
    handoffSummary: jsonb("handoff_summary").$type<CheckpointSummary>().notNull(),
    materials: jsonb("materials").$type<CheckpointMaterial[]>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("checkpoint_indices_project_task_idx").on(t.projectId, t.taskId),
    index("checkpoint_indices_task_created_idx").on(t.taskId, t.createdAt),
    index("checkpoint_indices_creator_idx").on(t.creatorId),
  ],
);

export type HandoffState = "offered" | "accepted" | "declined" | "withdrawn" | "superseded";

export const handoffRecords = pgTable(
  "handoff_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => checkpointIndices.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expectedTaskUpdatedAt: timestamp("expected_task_updated_at").notNull(),
    expectedHandoffVersion: integer("expected_handoff_version").notNull(),
    state: text("state").$type<HandoffState>().notNull().default("offered"),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("handoff_records_project_task_idx").on(t.projectId, t.taskId),
    index("handoff_records_to_user_state_idx").on(t.toUserId, t.state),
    index("handoff_records_from_user_state_idx").on(t.fromUserId, t.state),
    uniqueIndex("handoff_records_from_idempotency_unique").on(t.fromUserId, t.idempotencyKey),
  ],
);

export type AttemptKind = "continuation" | "parallel";
export type AttemptState = "started" | "finished" | "failed" | "unknown";

export type AttemptReceipt = {
  sessionId: string | null;
  headSha: string | null;
  changedPaths: string[];
  tests: Array<{
    commandLabel: string;
    exitCode: number | null;
    source: "captured" | "user-reported";
  }>;
};

export const attemptReceipts = pgTable(
  "attempt_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handoffId: uuid("handoff_id")
      .notNull()
      .references(() => handoffRecords.id, { onDelete: "cascade" }),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => checkpointIndices.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    baseSha: text("base_sha").notNull(),
    branchName: text("branch_name"),
    kind: text("kind").$type<AttemptKind>().notNull().default("continuation"),
    provider: text("provider").notNull().default("codex-cli"),
    providerVersion: text("provider_version").notNull().default("1.0.0"),
    state: text("state").$type<AttemptState>().notNull().default("started"),
    receipt: jsonb("receipt").$type<AttemptReceipt>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("attempt_receipts_handoff_idx").on(t.handoffId),
    index("attempt_receipts_task_actor_idx").on(t.taskId, t.actorId),
  ],
);
