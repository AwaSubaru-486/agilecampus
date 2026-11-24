import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, blockers, evidenceItems, projectEntries, projects, stageIntegrations, taskStages, tasks as taskTable, teamMembers, teams } from "@/db/schema";
import { buildContributionReport } from "./contribution";
import { listProjectEntries } from "./entry";
import { ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { listProjectTasks } from "./task";

export function listRetrospectiveProjects(actorId: string) {
  return db.select({ id: projects.id, name: projects.name, status: projects.status, teamName: teams.name, role: teamMembers.role })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(eq(teamMembers.userId, actorId))
    .orderBy(desc(projects.createdAt), desc(projects.id));
}

function textField(payload: unknown, key: "title" | "note" | "decision" | "completionNote") {
  if (typeof payload !== "object" || !payload) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function buildProjectRetrospective(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access || access.role === "student") throw new ForbiddenError();

  const [contribution, tasks, entries, archiveGroups, reviews, integrationGroups] = await Promise.all([
    buildContributionReport(actorId, projectId),
    listProjectTasks(actorId, projectId),
    listProjectEntries(actorId, projectId, { limit: 12 }),
    db.select({ taskId: projectEntries.taskId, type: projectEntries.type, count: sql<number>`count(*)::int` })
      .from(projectEntries).where(eq(projectEntries.projectId, projectId)).groupBy(projectEntries.taskId, projectEntries.type),
    db.select({ id: activityEvents.id, taskId: activityEvents.taskId, type: activityEvents.type, payload: activityEvents.payload, at: activityEvents.createdAt })
      .from(activityEvents)
      .where(and(eq(activityEvents.projectId, projectId), or(
        inArray(activityEvents.type, ["task_accepted", "task_rejected"]),
        and(eq(activityEvents.type, "task_updated"), sql`${activityEvents.payload}->>'recheck' = 'true'`),
      )))
      .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id)),
    db.select({ decision: stageIntegrations.decision, count: sql<number>`count(*)::int` })
      .from(stageIntegrations).innerJoin(taskStages, eq(taskStages.id, stageIntegrations.stageId))
      .where(eq(taskStages.projectId, projectId)).groupBy(stageIntegrations.decision),
  ]);

  const archives = { deliverable: 0, doc: 0, feedback: 0 };
  const archivedTaskIds = new Set<string>();
  for (const group of archiveGroups) {
    archives[group.type] += group.count;
    if (group.taskId && group.type !== "feedback") archivedTaskIds.add(group.taskId);
  }

  const latestReview = new Map<string, (typeof reviews)[number]>();
  const latestRecheck = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) {
    if (!review.taskId) continue;
    const byTask = review.type === "task_updated" ? latestRecheck : latestReview;
    if (!byTask.has(review.taskId)) byTask.set(review.taskId, review);
  }
  const accepted = tasks.flatMap(task => {
    if (task.status !== "done") return [];
    const decision = latestReview.get(task.id);
    const acceptedAt = decision ? decision.type === "task_accepted" ? decision.at : null : task.rejectCount === 0 ? task.reviewedAt : null;
    if (!acceptedAt || (task.submittedAt && acceptedAt < task.submittedAt)) return [];
    return [{ id: task.id, title: task.title, acceptedAt, completionNote: task.completionNote, reviewNote: task.reviewNote, hasArchive: archivedTaskIds.has(task.id) }];
  }).sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());

  const waiting = tasks.filter(task => task.status === "review").sort((a, b) =>
    (a.submittedAt?.getTime() ?? Infinity) - (b.submittedAt?.getTime() ?? Infinity));
  const rework = tasks.flatMap(task => {
    const review = latestReview.get(task.id);
    if ((task.status !== "doing" && task.status !== "todo") || review?.type !== "task_rejected" || (task.submittedAt && task.submittedAt > review.at)) return [];
    return [{ id: task.id, title: task.title, note: textField(review.payload, "note") }];
  });
  const rejected = reviews.filter(review => review.type === "task_rejected").slice(0, 3).map(review => ({
    id: review.id, title: textField(review.payload, "title") ?? "任务退回", note: textField(review.payload, "note"), at: review.at,
  }));
  const recheckFollowUp = accepted.flatMap(task => {
    const recheck = latestRecheck.get(task.id);
    if (!recheck || recheck.at < task.acceptedAt || textField(recheck.payload, "decision") !== "revise") return [];
    return [{ id: task.id, title: task.title, note: textField(recheck.payload, "note") }];
  });
  const integrations = { accepted: 0, pending: 0, rejected: 0 };
  for (const group of integrationGroups) {
    if (group.decision === "accepted" || group.decision === "pending" || group.decision === "rejected") integrations[group.decision] = group.count;
  }

  const doneCount = tasks.filter(task => task.status === "done").length;
  return {
    contribution, accepted, waiting, rework, rejected, recheckFollowUp, archives, entries, integrations,
    unarchived: accepted.filter(task => !task.hasArchive),
    completedWithoutReview: doneCount - accepted.length,
    hasRecords: reviews.length > 0 || doneCount > 0 || waiting.length > 0 || archiveGroups.length > 0 || integrationGroups.length > 0,
  };
}

export type ProjectRetrospective = Awaited<ReturnType<typeof buildProjectRetrospective>>;

export async function buildPersonalRetrospective(actorId: string, projectId: string, memberId = actorId) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access || access.role === "teacher") throw new ForbiddenError();
  if (memberId !== actorId && (access.role !== "admin" || (await getProjectForUser(memberId, projectId))?.role !== "student")) {
    throw new ForbiddenError();
  }

  const scope = and(eq(taskTable.projectId, projectId), eq(taskTable.assigneeId, memberId), eq(taskTable.isTaskGroup, false));
  const taskIds = db.select({ id: taskTable.id }).from(taskTable).where(scope);
  const [assigned, events, materials, openHelp] = await Promise.all([
    db.select({ id: taskTable.id, title: taskTable.title, status: taskTable.status, submittedAt: taskTable.submittedAt, updatedAt: taskTable.updatedAt })
      .from(taskTable).where(scope).orderBy(desc(taskTable.updatedAt), desc(taskTable.id)),
    db.select({ taskId: activityEvents.taskId, type: activityEvents.type, payload: activityEvents.payload, at: activityEvents.createdAt })
      .from(activityEvents).where(and(
        eq(activityEvents.projectId, projectId), inArray(activityEvents.taskId, taskIds),
        sql`${activityEvents.payload}->>'assigneeId' = ${memberId}`,
        or(inArray(activityEvents.type, ["task_submitted", "task_accepted", "task_rejected"]),
          and(eq(activityEvents.type, "task_updated"), sql`${activityEvents.payload}->>'recheck' = 'true'`)),
      )).orderBy(desc(activityEvents.createdAt), desc(activityEvents.id)),
    db.select({ taskId: evidenceItems.taskId, count: sql<number>`count(*)::int` }).from(evidenceItems)
      .where(and(eq(evidenceItems.projectId, projectId), eq(evidenceItems.submittedById, memberId), inArray(evidenceItems.taskId, taskIds)))
      .groupBy(evidenceItems.taskId),
    db.select({ id: blockers.id, taskId: taskTable.id, title: taskTable.title, needed: blockers.helpNeeded, detail: blockers.detail })
      .from(blockers).innerJoin(taskTable, eq(taskTable.id, blockers.taskId))
      .where(and(scope, eq(blockers.projectId, projectId), eq(blockers.raisedById, memberId), eq(blockers.status, "open")))
      .orderBy(desc(blockers.createdAt), desc(blockers.id)),
  ]);

  const activityByTask = new Map<string, (typeof events)[number][]>();
  for (const event of events) {
    if (!event.taskId) continue;
    const taskEvents = activityByTask.get(event.taskId) ?? [];
    taskEvents.push(event);
    activityByTask.set(event.taskId, taskEvents);
  }
  const materialCounts = new Map(materials.map(material => [material.taskId, material.count]));

  const deliveries = assigned.flatMap(task => {
    const taskEvents = activityByTask.get(task.id) ?? [];
    const submission = taskEvents.find(event => event.type === "task_submitted");
    const currentEvents = taskEvents.filter(event => !task.submittedAt || event.at >= task.submittedAt);
    const currentSubmission = currentEvents.find(event => event.type === "task_submitted");
    const verdict = currentEvents.find(event => event.type === "task_accepted" || event.type === "task_rejected");
    const recheck = currentEvents.find(event => event.type === "task_updated");
    const passed = task.status === "done" && verdict?.type === "task_accepted";
    const returned = (task.status === "doing" || task.status === "todo") && verdict?.type === "task_rejected";
    const needsRevision = passed && recheck && recheck.at >= verdict.at && textField(recheck.payload, "decision") === "revise";
    const evidenceCount = materialCounts.get(task.id) ?? 0;
    if (!submission && !verdict && task.status !== "done" && task.status !== "review" && !evidenceCount) return [];

    return [{
      id: task.id, title: task.title, status: task.status, at: currentSubmission?.at ?? verdict?.at ?? task.updatedAt,
      submitted: textField(currentSubmission?.payload, "completionNote"),
      feedback: needsRevision ? textField(recheck.payload, "note") : passed || returned ? textField(verdict.payload, "note") : null,
      passed, returned, needsRevision: Boolean(needsRevision), evidenceCount,
    }];
  });

  return { deliveries, openHelp, assignedCount: assigned.length };
}

export type PersonalRetrospective = Awaited<ReturnType<typeof buildPersonalRetrospective>>;
