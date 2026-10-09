import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { projects, taskDependencies, taskHandoffNotifications, tasks, taskStages, teamMembers, users } from "@/db/schema";
import { ForbiddenError } from "./errors";

type Task = typeof tasks.$inferSelect;

/** Caller serializes completions within the project, and persists this in the same transaction. */
export async function enqueueTaskHandoffs(tx: DbTx, source: Task, explicitTargets?: string[]) {
  const [rows, dependencies, stages, members] = await Promise.all([
    tx.select().from(tasks).where(eq(tasks.projectId, source.projectId)).orderBy(asc(tasks.sortOrder), asc(tasks.id)),
    tx.select({ before: taskDependencies.predecessorId, after: taskDependencies.successorId }).from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.predecessorId)).where(eq(tasks.projectId, source.projectId)),
    tx.select().from(taskStages).where(eq(taskStages.projectId, source.projectId)),
    tx.select({ userId: teamMembers.userId, role: teamMembers.role, kind: users.kind }).from(teamMembers)
      .innerJoin(projects, eq(projects.teamId, teamMembers.teamId)).innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(projects.id, source.projectId)),
  ]);
  const parentIds = new Set(rows.flatMap(row => row.parentTaskId ? [row.parentTaskId] : []));
  const leaves = rows.filter(row => !row.isTaskGroup && !parentIds.has(row.id));
  const outgoing = dependencies.filter(edge => edge.before === source.id).map(edge => edge.after);
  const sourceIndex = leaves.findIndex(row => row.id === source.id);
  // Tree order is only a fallback within the same stage and milestone; it does not unlock another stage.
  const next = sourceIndex < 0 ? undefined : leaves.slice(sourceIndex + 1).find(row =>
    row.stageId === source.stageId && row.milestoneId === source.milestoneId && row.status !== "done");
  const targetIds = explicitTargets ?? (outgoing.length ? outgoing : next ? [next.id] : []);
  const ready = leaves.filter(row => targetIds.includes(row.id)
    && (row.status === "todo" || row.status === "doing")
    && row.assigneeId && row.assigneeId !== source.assigneeId
    && members.some(member => member.userId === row.assigneeId && member.role !== "teacher" && member.kind === "human")
    && (!row.stageId || stages.some(stage => stage.id === row.stageId && stage.status === "active"))
    && dependencies.filter(edge => edge.after === row.id).every(edge => rows.some(before => before.id === edge.before && before.status === "done")));
  if (ready.length) await tx.insert(taskHandoffNotifications).values(ready.map(row => ({
    recipientId: row.assigneeId!, projectId: source.projectId, sourceTaskId: source.id,
    // The completion revision also changes for the legacy admin completion path after reopening.
    taskId: row.id, sourceSubmissionAt: source.updatedAt,
    sourceTitle: source.title,
  }))).onConflictDoNothing();
}

export async function enqueueStageHandoffs(tx: DbTx, stageId: string, previousStageId: string) {
  const sources = await tx.select().from(tasks).where(and(eq(tasks.stageId, previousStageId), eq(tasks.status, "done")));
  const source = sources.sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0))[0];
  if (!source) return;
  const targets = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.stageId, stageId));
  await enqueueTaskHandoffs(tx, source, targets.map(row => row.id));
}

// A changed assignee, departed member, archived project or completed task must not expose a stale alert.
const inboxAccess = (userId: string) => and(
  eq(taskHandoffNotifications.recipientId, userId), eq(teamMembers.userId, userId),
  ne(teamMembers.role, "teacher"),
  eq(tasks.assigneeId, userId), ne(projects.status, "archived"), inArray(tasks.status, ["todo", "doing"]),
  isNull(taskHandoffNotifications.dismissedAt),
);

export async function listTaskNotifications(userId: string) {
  return db.select({ id: taskHandoffNotifications.id, projectId: projects.id, projectName: projects.name,
    taskId: tasks.id, taskTitle: tasks.title, sourceTitle: taskHandoffNotifications.sourceTitle })
    .from(taskHandoffNotifications).innerJoin(projects, eq(projects.id, taskHandoffNotifications.projectId))
    .innerJoin(tasks, eq(tasks.id, taskHandoffNotifications.taskId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(inboxAccess(userId)).orderBy(asc(taskHandoffNotifications.createdAt)).limit(20);
}

export async function dismissTaskNotification(userId: string, id: string) {
  const [row] = await db.update(taskHandoffNotifications).set({ dismissedAt: new Date() })
    .where(and(eq(taskHandoffNotifications.id, id), eq(taskHandoffNotifications.recipientId, userId)))
    .returning({ id: taskHandoffNotifications.id });
  if (!row) throw new ForbiddenError();
}
