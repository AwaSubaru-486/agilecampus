import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { getProjectForUser } from "./project";
import { AppError, ForbiddenError } from "./errors";
import { recordEvent } from "./activity";

/** Teacher second review records feedback without repeating acceptance or downstream handoffs. */
export async function recheckCompletedTask(actorId: string, projectId: string, taskId: string, input: { decision: "accept" | "revise"; note?: string }) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access || access.role !== "teacher") throw new ForbiddenError("只有老师可以复核已完成任务");
  const note = input.note?.trim() ?? "";
  if (input.decision === "revise" && !note) throw new AppError("请填写需要修改或补充的内容");
  return db.transaction(async tx => {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).for("update");
    if (!task || task.status !== "done" || task.isTaskGroup) throw new AppError("只能复核本项目已完成的任务");
    if (task.assigneeId === actorId) throw new AppError("不能复核自己交付的任务");
    const verdict = input.decision === "accept" ? "老师复核通过" : "老师复核：需修改";
    const [updated] = await tx.update(tasks).set({ reviewNote: `${verdict}${note ? `：${note}` : ""}`, reviewedById: actorId, reviewedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(tasks.id, taskId)).returning();
    await recordEvent(tx, { projectId, actorId, taskId, type: "task_updated", summary: `${verdict}「${task.title}」`, payload: { recheck: true, decision: input.decision, note, assigneeId: task.assigneeId } });
    return updated;
  });
}
