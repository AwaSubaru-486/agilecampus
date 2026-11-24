import { emptyByStatus, type TaskStatus } from "./task-status";

export type OfficeTaskSummary = Record<TaskStatus, number> & { total: number };

/** Input comes from the permission-checked current project's task tree. */
export function summarizeOfficeTasks(tasks: readonly { assigneeId: string | null; isTaskGroup: boolean; status: string }[], viewUserId: string): OfficeTaskSummary {
  const counts = emptyByStatus();
  for (const task of tasks) {
    if (task.isTaskGroup || task.assigneeId !== viewUserId || !Object.hasOwn(counts, task.status)) continue;
    counts[task.status as TaskStatus]++;
  }
  return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}
