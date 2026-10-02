import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  checkpointIndices,
  sessionMemoryPublications,
  sessionMemorySharingSettings,
  sessionMemorySessions,
  tasks,
  users,
} from "@/db/schema";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";

function encodePublicationCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodePublicationCursor(cursor: string) {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    const createdAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (separator < 0 || !Number.isFinite(createdAt.getTime()) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Project index for the extension/web: only currently authorized shared versions. */
export async function listSessionMemoryPublications(
  actorId: string,
  projectId: string,
  options: { taskId?: string; cursor?: string; limit?: number } = {},
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");
  const sharing = await requireActiveSessionMemorySharing(actorId, projectId);

  if (options.taskId) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, options.taskId), eq(tasks.projectId, projectId)));
    if (!task) throw new NotFoundError("任务不存在或不属于该项目");
  }

  const limit = Math.min(Math.max(options.limit ?? 30, 1), 50);
  const cursor = options.cursor ? decodePublicationCursor(options.cursor) : undefined;
  if (options.cursor && !cursor) throw new AppError("会话列表游标无效");

  const rows = await db
    .select({
      id: sessionMemoryPublications.id,
      sessionId: sessionMemorySessions.id,
      sessionKey: sessionMemorySessions.sessionKey,
      projectId: sessionMemoryPublications.projectId,
      taskId: sessionMemoryPublications.taskId,
      taskTitle: tasks.title,
      publishedById: sessionMemoryPublications.publishedById,
      publishedByName: users.name,
      provider: sessionMemorySessions.provider,
      providerVersion: sessionMemorySessions.providerVersion,
      revision: sessionMemoryPublications.revision,
      completeness: sessionMemoryPublications.completeness,
      publishedAt: sessionMemoryPublications.publishedAt,
    })
    .from(sessionMemoryPublications)
    .innerJoin(sessionMemorySessions, and(
      eq(sessionMemorySessions.id, sessionMemoryPublications.sessionId),
      eq(sessionMemorySessions.projectId, sessionMemoryPublications.projectId),
      eq(sessionMemorySessions.taskId, sessionMemoryPublications.taskId),
    ))
    .innerJoin(tasks, and(
      eq(tasks.id, sessionMemoryPublications.taskId),
      eq(tasks.projectId, sessionMemoryPublications.projectId),
    ))
    .innerJoin(checkpointIndices, and(
      eq(checkpointIndices.id, sessionMemoryPublications.checkpointIndexId),
      eq(checkpointIndices.projectId, sessionMemoryPublications.projectId),
      eq(checkpointIndices.taskId, sessionMemoryPublications.taskId),
      eq(checkpointIndices.visibility, "project"),
    ))
    .innerJoin(users, eq(users.id, sessionMemoryPublications.publishedById))
    .where(and(
      eq(sessionMemoryPublications.projectId, projectId),
      eq(sessionMemoryPublications.sharingAuthorizationVersion, sharing.authorizationVersion),
      options.taskId ? eq(sessionMemoryPublications.taskId, options.taskId) : undefined,
      cursor ? sql`(${sessionMemoryPublications.publishedAt}, ${sessionMemoryPublications.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined,
    ))
    .orderBy(desc(sessionMemoryPublications.publishedAt), desc(sessionMemoryPublications.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodePublicationCursor(last.publishedAt, last.id) : null,
  };
}

/**
 * Read a published session-memory version only while the actor is still a
 * member of its project. Session-memory publications are project-scoped;
 * they must never turn an assignee-only checkpoint into a team-visible one.
 */
export async function getSessionMemoryPublicationForActor(
  actorId: string,
  publicationId: string,
) {
  const [publication] = await db
    .select()
    .from(sessionMemoryPublications)
    .where(eq(sessionMemoryPublications.id, publicationId));

  if (!publication) throw new NotFoundError("会话记忆版本不存在");

  const access = await getProjectForUser(actorId, publication.projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const [sharing] = await db
    .select({ authorizationVersion: sessionMemorySharingSettings.authorizationVersion, revokedAt: sessionMemorySharingSettings.revokedAt })
    .from(sessionMemorySharingSettings)
    .where(eq(sessionMemorySharingSettings.projectId, publication.projectId));
  if (!sharing || sharing.revokedAt || sharing.authorizationVersion !== publication.sharingAuthorizationVersion) {
    throw new NotFoundError("会话记忆分享已停用或授权版本已变化");
  }

  // The schema keeps these links separately for queryability. Re-check their
  // project/task agreement at the read boundary so a malformed row can never
  // disclose another task's memory to this project's members.
  const [session] = await db
    .select({ projectId: sessionMemorySessions.projectId, taskId: sessionMemorySessions.taskId, sessionKey: sessionMemorySessions.sessionKey })
    .from(sessionMemorySessions)
    .where(eq(sessionMemorySessions.id, publication.sessionId));
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, publication.taskId));
  const [checkpoint] = await db
    .select({ projectId: checkpointIndices.projectId, taskId: checkpointIndices.taskId, visibility: checkpointIndices.visibility })
    .from(checkpointIndices)
    .where(eq(checkpointIndices.id, publication.checkpointIndexId));

  if (
    !session ||
    !task ||
    !checkpoint ||
    session.projectId !== publication.projectId ||
    session.taskId !== publication.taskId ||
    task.projectId !== publication.projectId ||
    checkpoint.projectId !== publication.projectId ||
    checkpoint.taskId !== publication.taskId ||
    checkpoint.visibility !== "project"
  ) {
    // Treat inconsistent or private-linked rows as absent, not as an access
    // oracle. Registration is expected to reject these before publication.
    throw new NotFoundError("会话记忆版本不存在或当前不可见");
  }

  return {
    id: publication.id,
    sessionId: publication.sessionId,
    sessionKey: session.sessionKey,
    projectId: publication.projectId,
    taskId: publication.taskId,
    publishedById: publication.publishedById,
    checkpointIndexId: publication.checkpointIndexId,
    parentPublicationId: publication.parentPublicationId,
    packageId: publication.packageId,
    memoryId: publication.memoryId,
    revision: publication.revision,
    completeness: publication.completeness,
    sourceArchive: publication.sourceArchive,
    manifest: publication.manifest,
    memoryDocument: publication.memoryDocument,
    publishedAt: publication.publishedAt,
  };
}

/** Confirm a proposed session/task/checkpoint tuple before creating a session. */
export async function assertSessionMemoryProjectScope(
  actorId: string,
  input: { projectId: string; taskId: string; checkpointIndexId: string },
) {
  const access = await getProjectForUser(actorId, input.projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId)));
  if (!task) throw new NotFoundError("任务不存在或不属于该项目");

  const [checkpoint] = await db
    .select({ id: checkpointIndices.id, projectId: checkpointIndices.projectId, taskId: checkpointIndices.taskId, visibility: checkpointIndices.visibility, creatorId: checkpointIndices.creatorId })
    .from(checkpointIndices)
    .where(and(
      eq(checkpointIndices.id, input.checkpointIndexId),
      eq(checkpointIndices.projectId, input.projectId),
      eq(checkpointIndices.taskId, input.taskId),
    ));
  if (!checkpoint) throw new NotFoundError("检查点不存在或不属于该任务");
  if (checkpoint.visibility !== "project") {
    throw new ForbiddenError("仅项目共享检查点可以发布会话记忆");
  }
  if (checkpoint.creatorId !== actorId && access.role !== "admin") {
    throw new ForbiddenError("只有检查点创建者或项目管理员可以发布会话记忆");
  }

  return { task, checkpoint };
}

/** A project must have an active consent record before a publication is written. */
export async function requireActiveSessionMemorySharing(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");

  const [settings] = await db
    .select()
    .from(sessionMemorySharingSettings)
    .where(eq(sessionMemorySharingSettings.projectId, projectId));
  if (!settings || settings.revokedAt) {
    throw new ForbiddenError("该项目尚未授权会话记忆分享");
  }
  return settings;
}

/** Write-side gate for registration: ownership, task/checkpoint scope, and consent. */
export async function assertSessionMemoryPublicationScope(
  actorId: string,
  input: { sessionId: string; projectId: string; taskId: string; checkpointIndexId: string },
) {
  const [session] = await db
    .select({ id: sessionMemorySessions.id, projectId: sessionMemorySessions.projectId, taskId: sessionMemorySessions.taskId, creatorId: sessionMemorySessions.creatorId, originCheckpointIndexId: sessionMemorySessions.originCheckpointIndexId })
    .from(sessionMemorySessions)
    .where(eq(sessionMemorySessions.id, input.sessionId));
  if (!session) throw new NotFoundError("会话不存在");
  if (session.creatorId !== actorId) throw new ForbiddenError("只有会话绑定者可以发布此会话");
  if (session.projectId !== input.projectId || session.taskId !== input.taskId) {
    throw new NotFoundError("会话与项目或任务不匹配");
  }
  if (session.originCheckpointIndexId && session.originCheckpointIndexId !== input.checkpointIndexId) {
    throw new NotFoundError("会话关联检查点与待发布检查点不匹配");
  }

  const { task, checkpoint } = await assertSessionMemoryProjectScope(actorId, input);
  const sharing = await requireActiveSessionMemorySharing(actorId, input.projectId);
  return { session, task, checkpoint, sharing };
}
