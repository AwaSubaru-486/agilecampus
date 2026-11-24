import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  sessionMemoryDrafts,
  sessionMemoryPublications,
  sessionMemorySharingSettings,
  sessionMemorySessions,
  teamMembers,
} from "@/db/schema";
import type { MemoryDocumentV1, SessionMemoryManifestV1, SourceArchiveV1 } from "../shared/session-memory";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { createCheckpoint } from "@/lib/checkpoint";
import { createApiToken } from "@/lib/api-token";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { assertSessionMemoryProjectScope, assertSessionMemoryPublicationScope, getSessionMemoryPublicationForActor, requireActiveSessionMemorySharing } from "@/lib/session-memory/access";
import { GET as publicationRoute } from "@/app/api/extension/v1/session-publications/[publicationId]/route";
import { GET as sessionsRoute } from "@/app/api/extension/v1/projects/[projectId]/sessions/route";
import { resetDb } from "./helpers";

async function scene(checkpointVisibility: "project" | "assignee" = "project") {
  const owner = await createUser({ email: "memory-owner@test.local", password: "password123", name: "Owner" });
  const teammate = await createUser({ email: "memory-teammate@test.local", password: "password123", name: "Teammate" });
  const team = await createTeam(owner.id, "Session Memory Test");
  await joinTeam(teammate.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "Memory Project" });
  const task = await createTask(owner.id, project.id, { title: "Implement session memory" });
  await db.insert(sessionMemorySharingSettings).values({
    projectId: project.id,
    repositoryId: "123456789",
    disclosureVersion: "session-memory-v1",
    authorizedById: owner.id,
  });
  const checkpoint = await createCheckpoint(owner.id, project.id, task.id, {
    visibility: checkpointVisibility,
    taskHandoffVersion: task.handoffVersion,
    taskUpdatedAt: task.updatedAt,
    repositoryKeyHash: "repo-key-hash",
    headSha: "a".repeat(40),
    source: { provider: "codex", providerVersion: "test", captureMode: "context-only" },
    handoffSummary: { goal: "Test access boundary", completed: [], remaining: [], blocker: null, nextAction: "continue" },
    materials: [],
  });

  const [session] = await db.insert(sessionMemorySessions).values({
    sessionKey: randomUUID(),
    projectId: project.id,
    taskId: task.id,
    creatorId: owner.id,
    originCheckpointIndexId: checkpoint.id,
    provider: "codex",
    providerVersion: "test",
    adapter: "fixture",
    adapterVersion: "1",
    taskHandoffVersion: task.handoffVersion,
    taskUpdatedAt: task.updatedAt,
    repositoryKeyHash: "repo-key-hash",
  }).returning();

  const memoryId = randomUUID();
  const document = { schemaVersion: 1, id: memoryId } as MemoryDocumentV1;
  const [draft] = await db.insert(sessionMemoryDrafts).values({
    sessionId: session.id,
    projectId: project.id,
    taskId: task.id,
    createdById: owner.id,
    checkpointIndexId: checkpoint.id,
    memoryId,
    revision: 1,
    inputDigest: "digest",
    document,
  }).returning();

  const manifest = { schemaVersion: 1, packageId: randomUUID(), sessionKey: session.sessionKey } as SessionMemoryManifestV1;
  const sourceArchive = { schemaVersion: 1, status: "unavailable" } as SourceArchiveV1;
  const [publication] = await db.insert(sessionMemoryPublications).values({
    sessionId: session.id,
    projectId: project.id,
    taskId: task.id,
    publishedById: owner.id,
    checkpointIndexId: checkpoint.id,
    sharingAuthorizationVersion: 1,
    draftId: draft.id,
    packageId: randomUUID(),
    memoryId,
    revision: 1,
    completeness: "unavailable",
    sourceArchive,
    manifest,
    memoryDocument: document,
    repositoryId: "123456",
    commitSha: "b".repeat(40),
    packagePath: `projects/${project.id}/sessions/${session.sessionKey}/packages/test`,
    manifestSha256: "c".repeat(64),
    idempotencyKey: randomUUID(),
  }).returning();

  return { owner, teammate, team, project, task, checkpoint, session, publication };
}

describe("session-memory publication access boundary", () => {
  beforeEach(resetDb);

  it("allows current project members to read a project publication", async () => {
    const { teammate, publication } = await scene();
    const result = await getSessionMemoryPublicationForActor(teammate.id, publication.id);
    expect(result.id).toBe(publication.id);
    expect(result.completeness).toBe("unavailable");
  });

  it("exposes publication detail only through an authenticated, no-store extension response", async () => {
    const { owner, teammate, publication } = await scene();
    const { token: ownerToken } = await createApiToken(owner.id, "session memory owner test token");
    const { token: teammateToken } = await createApiToken(teammate.id, "session memory teammate test token");
    const params = { params: Promise.resolve({ publicationId: publication.id }) };

    const anonymous = await publicationRoute(new Request("http://localhost/api/extension/v1/session-publications/test"), params);
    expect(anonymous.status).toBe(401);

    const response = await publicationRoute(new Request("http://localhost/api/extension/v1/session-publications/test", {
      headers: { authorization: `Bearer ${teammateToken}` },
    }), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).id).toBe(publication.id);

    const ownerResponse = await publicationRoute(new Request("http://localhost/api/extension/v1/session-publications/test", {
      headers: { authorization: `Bearer ${ownerToken}` },
    }), params);
    expect(ownerResponse.status).toBe(200);
  });

  it("lists only currently authorized project publications with a no-store response", async () => {
    const { teammate, project, task, publication } = await scene();
    const { token } = await createApiToken(teammate.id, "session memory list token");
    const response = await sessionsRoute(new Request(`http://localhost/api/extension/v1/projects/${project.id}/sessions?taskId=${task.id}`, {
      headers: { authorization: `Bearer ${token}` },
    }), { params: Promise.resolve({ projectId: project.id }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe(publication.id);
    expect(data.items[0].taskId).toBe(task.id);
  });

  it("revokes access immediately when a project member leaves", async () => {
    const { teammate, team, publication } = await scene();
    const { token } = await createApiToken(teammate.id, "revocation test token");
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, teammate.id)));
    await expect(getSessionMemoryPublicationForActor(teammate.id, publication.id)).rejects.toBeInstanceOf(ForbiddenError);
    const response = await publicationRoute(new Request("http://localhost/api/extension/v1/session-publications/test", {
      headers: { authorization: `Bearer ${token}` },
    }), { params: Promise.resolve({ publicationId: publication.id }) });
    expect(response.status).toBe(403);
  });

  it("stops publication reads after share consent is revoked or versioned again", async () => {
    const { teammate, project, publication } = await scene();
    await db.update(sessionMemorySharingSettings)
      .set({ revokedAt: new Date() })
      .where(eq(sessionMemorySharingSettings.projectId, project.id));
    await expect(getSessionMemoryPublicationForActor(teammate.id, publication.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not expose a publication linked to an assignee-only checkpoint", async () => {
    const { teammate, publication } = await scene("assignee");
    await expect(getSessionMemoryPublicationForActor(teammate.id, publication.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fails closed when persisted publication metadata points at another task", async () => {
    const { owner, project, publication } = await scene();
    const otherTask = await createTask(owner.id, project.id, { title: "Different task" });
    await db.update(sessionMemoryPublications)
      .set({ taskId: otherTask.id })
      .where(eq(sessionMemoryPublications.id, publication.id));

    await expect(getSessionMemoryPublicationForActor(owner.id, publication.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only permits project-visible checkpoints from the same task/project to enter sharing", async () => {
    const { owner, project, task, checkpoint } = await scene("assignee");
    await expect(assertSessionMemoryProjectScope(owner.id, {
      projectId: project.id,
      taskId: task.id,
      checkpointIndexId: checkpoint.id,
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires an active project consent and the bound session owner before publication", async () => {
    const { owner, teammate, project, task, checkpoint, session } = await scene();
    const input = { sessionId: session.id, projectId: project.id, taskId: task.id, checkpointIndexId: checkpoint.id };
    const authorized = await assertSessionMemoryPublicationScope(owner.id, input);
    expect(authorized.sharing.authorizationVersion).toBe(1);
    await expect(assertSessionMemoryPublicationScope(teammate.id, input)).rejects.toBeInstanceOf(ForbiddenError);

    await db.update(sessionMemorySharingSettings)
      .set({ revokedAt: new Date() })
      .where(eq(sessionMemorySharingSettings.projectId, project.id));
    await expect(requireActiveSessionMemorySharing(owner.id, project.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a task ID that does not belong to the requested project", async () => {
    const { owner, project, team, checkpoint } = await scene();
    const otherProject = await createProject(owner.id, team.id, { name: "Different project" });
    const otherTask = await createTask(owner.id, otherProject.id, { title: "Other project task" });

    await expect(assertSessionMemoryProjectScope(owner.id, {
      projectId: project.id,
      taskId: otherTask.id,
      checkpointIndexId: checkpoint.id,
    })).rejects.toBeInstanceOf(NotFoundError);
  });
});
