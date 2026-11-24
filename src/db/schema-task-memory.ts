import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects, tasks, users } from "./schema";
import type { MemoryHandoffExportV1 } from "../../shared/task-memory/transfer";
import type { ContinuationState } from "../../shared/task-memory/continuation-status";

/** Explicitly shared, immutable task summaries. Raw transcripts and workspace files are not accepted. */
export const taskMemoryVersions = pgTable("task_memory_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  memoryId: uuid("memory_id").notNull(),
  revision: integer("revision").notNull(),
  materialDigest: text("material_digest").notNull(),
  payload: jsonb("payload").$type<MemoryHandoffExportV1>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("task_memory_versions_identity_unique").on(t.projectId, t.taskId, t.memoryId, t.revision),
  index("task_memory_versions_task_created_idx").on(t.projectId, t.taskId, t.createdAt),
  check("task_memory_versions_revision_positive", sql`${t.revision} > 0`),
]);

export const taskMemoryContinuations = pgTable("task_memory_continuations", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").notNull().references(() => taskMemoryVersions.id, { onDelete: "cascade" }),
  state: text("state").$type<ContinuationState>().notNull().default("waiting"),
  sequence: integer("sequence").notNull().default(0),
  claimId: uuid("claim_id"),
  attemptId: uuid("attempt_id"),
  events: jsonb("events").$type<Array<{ state: ContinuationState; at: string }>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("task_memory_continuations_requester_idx").on(t.requesterId, t.projectId, t.taskId, t.createdAt)]);
