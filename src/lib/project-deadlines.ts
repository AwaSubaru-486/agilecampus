import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { DUE_SOON_DAYS } from "./action-queue";
import { ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { TASK_STATUSES, isActive } from "./task-status";
import { today } from "./today";

export async function listProjectDeadlineWarnings(actorId: string, projectId: string, options: {
  onDate?: string;
  viewMemberId?: string;
} = {}) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (access.role === "teacher" || access.project.status === "archived") return [];

  const day = options.onDate ?? today();
  const assigneeId = access.role === "student" ? actorId : options.viewMemberId;

  return db.select({
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    assigneeName: users.name,
    dueDate: sql<string>`${tasks.dueDate}::text`,
    daysRemaining: sql<number>`${tasks.dueDate} - cast(${day} as date)`,
  }).from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(
      eq(tasks.projectId, projectId),
      eq(tasks.isTaskGroup, false),
      inArray(tasks.status, TASK_STATUSES.filter(isActive)),
      lte(tasks.dueDate, sql`cast(${day} as date) + cast(${DUE_SOON_DAYS} as integer)`),
      assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
    ))
    .orderBy(asc(tasks.dueDate), asc(tasks.id));
}
