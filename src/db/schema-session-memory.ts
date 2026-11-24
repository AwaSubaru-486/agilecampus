import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  MemoryDocumentV1,
  SessionMemoryManifestV1,
  SourceArchiveV1,
} from "../../shared/session-memory";
import { projects, tasks, users } from "./schema";
import { checkpointIndices } from "./schema-checkpoint";

export const sessionMemoryArchiveStatusEnum = pgEnum("session_memory_archive_status", ["complete", "partial", "unavailable"]);
export const sessionMemoryJobStatusEnum = pgEnum("session_memory_job_status", ["queued", "running", "completed", "failed", "unknown"]);
export const sessionMemoryDraftStatusEnum = pgEnum("session_memory_draft_status", ["draft", "published", "superseded"]);
export type SessionMemoryArchiveStatus = (typeof sessionMemoryArchiveStatusEnum.enumValues)[number];
export type SessionMemoryJobStatus = (typeof sessionMemoryJobStatusEnum.enumValues)[number];
export type SessionMemoryDraftStatus = (typeof sessionMemoryDraftStatusEnum.enumValues)[number];

/** Explicit, revocable project consent. It contains repository identity, never a GitHub credential. */
export const sessionMemorySharingSettings = pgTable(
  "session_memory_sharing_settings",
  {
    projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id").notNull(),
    scope: text("scope").notNull().default("project"),
    repositoryVisibility: text("repository_visibility").notNull().default("private"),
    disclosureVersion: text("disclosure_version").notNull(),
    authorizationVersion: integer("authorization_version").notNull().default(1),
    authorizedById: uuid("authorized_by_id").references(() => users.id, { onDelete: "set null" }),
    authorizedAt: timestamp("authorized_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("session_memory_sharing_scope_project_only", sql`${t.scope} = 'project'`),
    check("session_memory_sharing_private_repo_only", sql`${t.repositoryVisibility} = 'private'`),
    check("session_memory_sharing_repository_id_numeric", sql`${t.repositoryId} ~ '^[0-9]+$'`),
    check("session_memory_sharing_authorization_version_positive", sql`${t.authorizationVersion} > 0`),
  ],
);

/** Logical, project-bound Agent session. Native provider IDs and local paths are intentionally absent. */
export const sessionMemorySessions = pgTable(
  "session_memory_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionKey: uuid("session_key").notNull().unique(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    originCheckpointIndexId: uuid("origin_checkpoint_index_id").references(() => checkpointIndices.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    providerVersion: text("provider_version").notNull(),
    adapter: text("adapter").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    taskHandoffVersion: integer("task_handoff_version").notNull(),
    taskUpdatedAt: timestamp("task_updated_at").notNull(),
    repositoryKeyHash: text("repository_key_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    lastEventAt: timestamp("last_event_at"),
  },
  (t) => [
    index("session_memory_sessions_project_task_created_idx").on(t.projectId, t.taskId, t.createdAt),
    index("session_memory_sessions_creator_created_idx").on(t.creatorId, t.createdAt),
    index("session_memory_sessions_origin_checkpoint_idx").on(t.originCheckpointIndexId),
  ],
);

/** Durable extraction operation. It stores job metadata, never provider credentials or raw transcript bytes. */
export const sessionMemoryExtractionJobs = pgTable(
  "session_memory_extraction_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => sessionMemorySessions.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    checkpointIndexId: uuid("checkpoint_index_id").references(() => checkpointIndices.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    inputDigest: text("input_digest").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    modelConfigurationDigest: text("model_configuration_digest").notNull(),
    status: sessionMemoryJobStatusEnum("status").notNull().default("queued"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    safeErrorCode: text("safe_error_code"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_memory_jobs_actor_idempotency_unique").on(t.createdById, t.idempotencyKey),
    uniqueIndex("session_memory_jobs_active_input_unique")
      .on(t.sessionId, t.inputDigest, t.promptVersion, t.modelConfigurationDigest)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("session_memory_jobs_session_created_idx").on(t.sessionId, t.createdAt),
    index("session_memory_jobs_project_task_status_idx").on(t.projectId, t.taskId, t.status),
    index("session_memory_jobs_checkpoint_idx").on(t.checkpointIndexId),
    check("session_memory_jobs_token_counts_nonnegative", sql`(${t.inputTokens} is null or ${t.inputTokens} >= 0) and (${t.outputTokens} is null or ${t.outputTokens} >= 0)`),
  ],
);

/** Immutable human-editable memory document revisions; raw transcript content stays in the private artifact store. */
export const sessionMemoryDrafts = pgTable(
  "session_memory_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => sessionMemorySessions.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    checkpointIndexId: uuid("checkpoint_index_id").references(() => checkpointIndices.id, { onDelete: "set null" }),
    extractionJobId: uuid("extraction_job_id").unique().references(() => sessionMemoryExtractionJobs.id, { onDelete: "set null" }),
    parentDraftId: uuid("parent_draft_id").references((): AnyPgColumn => sessionMemoryDrafts.id, { onDelete: "set null" }),
    memoryId: uuid("memory_id").notNull(),
    revision: integer("revision").notNull(),
    inputDigest: text("input_digest").notNull(),
    status: sessionMemoryDraftStatusEnum("status").notNull().default("draft"),
    document: jsonb("document").$type<MemoryDocumentV1>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_memory_drafts_session_revision_unique").on(t.sessionId, t.revision),
    index("session_memory_drafts_project_task_status_idx").on(t.projectId, t.taskId, t.status),
    index("session_memory_drafts_creator_created_idx").on(t.createdById, t.createdAt),
    index("session_memory_drafts_checkpoint_idx").on(t.checkpointIndexId),
    index("session_memory_drafts_parent_idx").on(t.parentDraftId),
    check("session_memory_drafts_revision_positive", sql`${t.revision} > 0`),
  ],
);

/** Published immutable package/version index. Transcript bytes remain in the versioned private Git repository. */
export const sessionMemoryPublications = pgTable(
  "session_memory_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => sessionMemorySessions.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    publishedById: uuid("published_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    checkpointIndexId: uuid("checkpoint_index_id").notNull().references(() => checkpointIndices.id, { onDelete: "cascade" }),
    sharingAuthorizationVersion: integer("sharing_authorization_version").notNull(),
    draftId: uuid("draft_id").notNull().unique(),
    parentPublicationId: uuid("parent_publication_id").references((): AnyPgColumn => sessionMemoryPublications.id, { onDelete: "set null" }),
    packageId: uuid("package_id").notNull().unique(),
    memoryId: uuid("memory_id").notNull(),
    revision: integer("revision").notNull(),
    completeness: sessionMemoryArchiveStatusEnum("completeness").notNull(),
    sourceArchive: jsonb("source_archive").$type<SourceArchiveV1>().notNull(),
    manifest: jsonb("manifest").$type<SessionMemoryManifestV1>().notNull(),
    memoryDocument: jsonb("memory_document").$type<MemoryDocumentV1>().notNull(),
    repositoryId: text("repository_id").notNull(),
    commitSha: text("commit_sha").notNull(),
    packagePath: text("package_path").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_memory_publications_session_revision_unique").on(t.sessionId, t.revision),
    uniqueIndex("session_memory_publications_actor_idempotency_unique").on(t.publishedById, t.idempotencyKey),
    index("session_memory_publications_project_task_published_idx").on(t.projectId, t.taskId, t.publishedAt),
    index("session_memory_publications_session_published_idx").on(t.sessionId, t.publishedAt),
    index("session_memory_publications_checkpoint_idx").on(t.checkpointIndexId),
    index("session_memory_publications_parent_idx").on(t.parentPublicationId),
    check("session_memory_publications_revision_positive", sql`${t.revision} > 0`),
    check("session_memory_publications_authorization_version_positive", sql`${t.sharingAuthorizationVersion} > 0`),
    check("session_memory_publications_complete_archive_check", sql`${t.completeness} <> 'complete' or (${t.sourceArchive}->>'status') = 'complete'`),
  ],
);
