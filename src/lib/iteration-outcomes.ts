import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { activityEvents, evidenceItems, taskDeliveries, tasks } from "@/db/schema";
import type { IterationOutcome } from "./iteration-types";

function outcomeKey(outcome: Pick<IterationOutcome, "taskId" | "submittedAt">) {
  return `${outcome.taskId}:${outcome.submittedAt ?? ""}`;
}

/** Called after project access is checked. Released snapshots consume each accepted submission once. */
export async function readUnarchivedOutcomes(
  projectId: string,
  archived: IterationOutcome[],
  exec: DbTx | typeof db = db,
): Promise<IterationOutcome[]> {
  const acceptance = exec.select({ acceptedAt: activityEvents.createdAt }).from(activityEvents)
    .where(and(eq(activityEvents.projectId, projectId), eq(activityEvents.taskId, tasks.id), eq(activityEvents.type, "task_accepted")))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id)).limit(1).as("acceptance");
  const delivery = exec.select({ url: taskDeliveries.pullRequestUrl }).from(taskDeliveries)
    .where(and(eq(taskDeliveries.taskId, tasks.id), lte(taskDeliveries.createdAt, sql`coalesce(${tasks.submittedAt}, ${tasks.reviewedAt})`)))
    .orderBy(desc(taskDeliveries.createdAt), desc(taskDeliveries.id)).limit(1).as("delivery");
  const evidence = exec.select({ url: evidenceItems.value }).from(evidenceItems)
    .where(and(eq(evidenceItems.projectId, projectId), eq(evidenceItems.taskId, tasks.id),
      inArray(evidenceItems.type, ["link", "demo"]), sql`${evidenceItems.value} ~* '^https?://'`,
      lte(evidenceItems.createdAt, sql`coalesce(${acceptance.acceptedAt}, ${tasks.reviewedAt})`)))
    .orderBy(desc(evidenceItems.createdAt), desc(evidenceItems.id)).limit(1).as("evidence");
  const rows = await exec.select({
    taskId: tasks.id, title: tasks.title, summary: tasks.completionNote, submittedAt: tasks.submittedAt,
    acceptedAt: acceptance.acceptedAt, reviewedAt: tasks.reviewedAt, deliveryUrl: delivery.url, evidenceUrl: evidence.url,
  }).from(tasks).leftJoinLateral(acceptance, sql`true`).leftJoinLateral(delivery, sql`true`).leftJoinLateral(evidence, sql`true`)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, "done"), eq(tasks.isTaskGroup, false), isNotNull(tasks.reviewedAt)))
    .orderBy(sql`coalesce(${acceptance.acceptedAt}, ${tasks.reviewedAt}) desc`, desc(tasks.id));

  const archivedKeys = new Set(archived.map(outcomeKey));
  return rows.flatMap(row => {
    const summary = row.summary?.trim();
    const acceptedAt = row.acceptedAt ?? row.reviewedAt;
    const submittedAt = row.submittedAt?.toISOString() ?? null;
    if (!summary || !acceptedAt || archivedKeys.has(outcomeKey({ taskId: row.taskId, submittedAt }))) return [];
    return [{ taskId: row.taskId, title: row.title, summary, submittedAt, acceptedAt: acceptedAt.toISOString(),
      resultUrl: [row.deliveryUrl, row.evidenceUrl].find(url => /^https?:\/\//i.test(url ?? "")) ?? null }];
  });
}
