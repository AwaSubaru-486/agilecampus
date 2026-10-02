import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { listProjectActivity } from "@/lib/activity-feed";
import { createAttempt, createCheckpoint, createHandoff, resolveHandoff } from "@/lib/checkpoint";
import {
  sessionMemoryDrafts,
  sessionMemoryExtractionJobs,
  sessionMemoryPublications,
  sessionMemorySharingSettings,
  sessionMemorySessions,
} from "@/db/schema";
import type { MemoryDocumentV1, SessionMemoryManifestV1, SourceArchiveV1 } from "../shared/session-memory";
import { resetDb, TRUNCATED_TABLES } from "./helpers";

// 守卫测试。新增表却忘了加进 resetDb 的 TRUNCATE 列表时，
// 失败形态是「跨用例脏数据导致的偶发红」而非明确报错——最贵的调试形态。
// 这两条断言把它变成一次明确的失败。

async function tableNames(): Promise<string[]> {
  const res = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return (res as unknown as { tablename: string }[]).map((r) => r.tablename);
}

async function countOf(table: string): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`);
  return (res as unknown as { n: number }[])[0].n;
}

describe("resetDb 表清单", () => {
  it("覆盖库中所有业务表", async () => {
    const all = await tableNames();
    const missing = all.filter((n) => !(TRUNCATED_TABLES as readonly string[]).includes(n));
    // 有遗漏即在此报出表名，不必等某天冒出一条莫名其妙的红
    expect(missing).toEqual([]);
  });

  it("清单里的表在库中确实存在，无笔误", async () => {
    const all = await tableNames();
    const ghost = TRUNCATED_TABLES.filter((t) => !all.includes(t));
    expect(ghost).toEqual([]);
  });
});

describe("resetDb 清空效果", () => {
  beforeEach(resetDb);

  it("活动流表随 resetDb 清零", async () => {
    const owner = await createUser({
      email: "owner@example.com",
      password: "password123",
      name: "owner",
    });
    const team = await createTeam(owner.id, "东吴实验室");
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    await createTask(owner.id, project.id, { title: "甲" });
    expect((await listProjectActivity(owner.id, project.id)).length).toBeGreaterThan(0);

    await resetDb();
    expect(await countOf("activity_events")).toBe(0);
  });

  it("清空检查点、交接单和 Attempt 执行记录", async () => {
    const owner = await createUser({ email: "owner@example.com", password: "password123", name: "owner" });
    const teammate = await createUser({ email: "teammate@example.com", password: "password123", name: "teammate" });
    const team = await createTeam(owner.id, "测试交接组");
    await joinTeam(teammate.id, team.inviteCode);
    const project = await createProject(owner.id, team.id, { name: "检查点清理测试" });
    const task = await createTask(owner.id, project.id, { title: "清理后不留痕" });
    await db.insert(sessionMemorySharingSettings).values({
      projectId: project.id,
      repositoryId: "123456789",
      disclosureVersion: "session-memory-v1",
      authorizedById: owner.id,
    });
    const headSha = "a".repeat(40);
    const checkpoint = await createCheckpoint(owner.id, project.id, task.id, {
      taskHandoffVersion: task.handoffVersion,
      taskUpdatedAt: task.updatedAt,
      repositoryKeyHash: "test-repo-hash",
      headSha,
      source: { provider: "codex-cli", providerVersion: "0.153.4", captureMode: "context-only" },
      handoffSummary: { goal: "reset test", completed: [], remaining: ["verify reset"], blocker: null, nextAction: "reset" },
      materials: [],
    });
    const sessionKey = "00000000-0000-4000-8000-000000009001";
    const [session] = await db.insert(sessionMemorySessions).values({
      sessionKey,
      projectId: project.id,
      taskId: task.id,
      creatorId: owner.id,
      originCheckpointIndexId: checkpoint.id,
      provider: "codex-cli",
      providerVersion: "0.153.4",
      adapter: "entire",
      adapterVersion: "0.11.3",
      taskHandoffVersion: task.handoffVersion,
      taskUpdatedAt: task.updatedAt,
      repositoryKeyHash: "test-repository-key-hash",
    }).returning({ id: sessionMemorySessions.id });
    const [job] = await db.insert(sessionMemoryExtractionJobs).values({
      sessionId: session.id,
      projectId: project.id,
      taskId: task.id,
      createdById: owner.id,
      checkpointIndexId: checkpoint.id,
      idempotencyKey: "reset-session-memory-job",
      inputDigest: "a".repeat(64),
      promptVersion: "memory-v1",
      model: "test-model",
      modelConfigurationDigest: "b".repeat(64),
      status: "completed",
    }).returning({ id: sessionMemoryExtractionJobs.id });
    const memoryDocument = {
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000009002",
      sessionKey,
      projectId: project.id,
      taskId: task.id,
      parentMemoryId: null,
      revision: 1,
      inputDigest: "a".repeat(64),
      sourceCoverage: { fromSequence: 1, toSequence: 1, gaps: [] },
      code: { repositoryKeyHash: "test-repository-key-hash", headSha, dirtyExcluded: true },
      goal: [], constraints: [], completed: [], remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [], tests: [],
      provenance: { extractor: "fixture", promptVersion: "memory-v1", model: "test-model", createdAt: new Date().toISOString(), editedBy: null, usage: { inputTokens: null, outputTokens: null } },
    } as MemoryDocumentV1;
    const [draft] = await db.insert(sessionMemoryDrafts).values({
      sessionId: session.id,
      projectId: project.id,
      taskId: task.id,
      createdById: owner.id,
      checkpointIndexId: checkpoint.id,
      extractionJobId: job.id,
      memoryId: memoryDocument.id,
      revision: 1,
      inputDigest: memoryDocument.inputDigest,
      document: memoryDocument,
    }).returning({ id: sessionMemoryDrafts.id });
    const archiveDescriptor = {
      schemaVersion: 1 as const,
      status: "unavailable" as const,
      provider: "codex-cli",
      providerVersion: "0.153.4",
      adapter: "entire",
      adapterVersion: "0.11.3",
      parserVersion: "opaque-text-v1" as const,
      encoding: "utf-8" as const,
      compression: "none" as const,
      integrityStatus: "unavailable" as const,
      sourceByteLength: null,
      publishedDigest: null,
      publishedByteLength: 0,
      reachedEof: false,
      truncationDetected: false,
      formatRecognized: false,
      gaps: [],
      redaction: { confirmed: false, confirmedAt: null, previewDigest: null, redactedRanges: [], excludedRanges: [], redactedByteCount: 0, excludedByteCount: 0 },
      segments: [], eventRanges: [], unmappedEvents: [],
    } as SourceArchiveV1;
    const manifest = {
      schemaVersion: 1,
      packageId: "00000000-0000-4000-8000-000000009003",
      sessionKey,
      memoryId: memoryDocument.id,
      checkpointLocalId: "00000000-0000-4000-8000-000000009004",
      projectId: project.id,
      taskId: task.id,
      parentPackageId: null,
      codeHeadSha: headSha,
      taskHandoffVersion: task.handoffVersion,
      taskUpdatedAt: task.updatedAt.toISOString(),
      sourceCoverage: { fromSequence: 1, toSequence: 1, gaps: [] },
      segments: [],
    } as SessionMemoryManifestV1;
    await db.insert(sessionMemoryPublications).values({
      sessionId: session.id,
      projectId: project.id,
      taskId: task.id,
      publishedById: owner.id,
      checkpointIndexId: checkpoint.id,
      sharingAuthorizationVersion: 1,
      draftId: draft.id,
      packageId: manifest.packageId,
      memoryId: memoryDocument.id,
      revision: 1,
      completeness: "unavailable",
      sourceArchive: archiveDescriptor,
      manifest,
      memoryDocument,
      repositoryId: "test-repository",
      commitSha: headSha,
      packagePath: `projects/${project.id}/sessions/${sessionKey}/packages/${manifest.packageId}`,
      manifestSha256: "c".repeat(64),
      idempotencyKey: "reset-session-memory-publication",
    });
    const handoff = await createHandoff(owner.id, project.id, task.id, {
      checkpointId: checkpoint.id,
      toUserId: teammate.id,
      expectedTaskUpdatedAt: task.updatedAt,
      expectedHandoffVersion: task.handoffVersion,
      idempotencyKey: "reset-db-handoff-test",
    });
    await resolveHandoff(teammate.id, handoff.record.id, "accept", {
      expectedHandoffVersion: handoff.record.expectedHandoffVersion,
    });
    await createAttempt(teammate.id, handoff.record.id, { baseSha: headSha });

    await resetDb();

    expect(await countOf("checkpoint_indices")).toBe(0);
    expect(await countOf("handoff_records")).toBe(0);
    expect(await countOf("attempt_receipts")).toBe(0);
    expect(await countOf("session_memory_sessions")).toBe(0);
    expect(await countOf("session_memory_extraction_jobs")).toBe(0);
    expect(await countOf("session_memory_drafts")).toBe(0);
    expect(await countOf("session_memory_publications")).toBe(0);
    expect(await countOf("session_memory_sharing_settings")).toBe(0);
  });

  it("join 团队亦被清空", async () => {
    const owner = await createUser({
      email: "owner@example.com",
      password: "password123",
      name: "owner",
    });
    const team = await createTeam(owner.id, "东吴实验室");
    const guest = await createUser({
      email: "guest@example.com",
      password: "password123",
      name: "guest",
    });
    await joinTeam(guest.id, team.inviteCode);
    expect(await countOf("team_members")).toBe(2);

    await resetDb();
    expect(await countOf("team_members")).toBe(0);
  });
});
