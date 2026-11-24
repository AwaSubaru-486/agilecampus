import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tasks, taskStages, stageIntegrations } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { getProjectPerspective } from "./project-view";
import { projectOperationContext } from "./project-operation-context";
import { recordEvent } from "./activity";

type Target = { kind: "task" | "stage" | "integration"; id: string };

/** Trusted caller supplies the authenticated operator, never a client-provided identity. */
export async function runProjectOperation<T>(operatorId: string, projectId: string, action: string, execute: (actingAsId: string) => Promise<T>, target?: Target): Promise<T> {
  if (!z.uuid().safeParse(projectId).success || (target && !z.uuid().safeParse(target.id).success)) throw new AppError("项目或任务参数无效");
  const access = await getProjectForUser(operatorId, projectId);
  if (!access) throw new ForbiddenError("无权访问该项目");
  if (target) {
    const found = target.kind === "task"
      ? await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, target.id), eq(tasks.projectId, projectId)))
      : target.kind === "stage"
        ? await db.select({ id: taskStages.id }).from(taskStages).where(and(eq(taskStages.id, target.id), eq(taskStages.projectId, projectId)))
        : await db.select({ id: stageIntegrations.id }).from(stageIntegrations).innerJoin(taskStages, eq(stageIntegrations.stageId, taskStages.id)).where(and(eq(stageIntegrations.id, target.id), eq(taskStages.projectId, projectId)));
    if (!found.length) throw new ForbiddenError("操作对象不属于当前项目");
  }
  const perspective = await getProjectPerspective(access.role, projectId, operatorId, access.project.teamId);
  if (perspective.invalidSelection) throw new ForbiddenError("所选成员或角色已变化，请重新切换视角");
  if (!perspective.delegated) return execute(operatorId);
  // Resolve and re-check membership/role on every mutation, not just when switching.
  const represented = await getProjectForUser(perspective.viewUserId, projectId);
  if (!represented || represented.role !== perspective.role || access.role !== "admin") throw new ForbiddenError("所选身份已失效，请重新切换视角");
  return projectOperationContext.run({ projectId, operatorId, actingAsId: perspective.viewUserId, actingAsName: perspective.viewUserName ?? "成员", role: perspective.role, recorded: false }, async () => {
    const result = await execute(perspective.viewUserId);
    if (!projectOperationContext.getStore()!.recorded) {
      await recordEvent(db, { projectId, actorId: perspective.viewUserId, type: "task_updated", taskId: target?.kind === "task" ? target.id : null, summary: action, payload: { action, target: target ?? null } });
    }
    return result;
  });
}
