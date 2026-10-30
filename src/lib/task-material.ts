import { getContextPackForUser } from "./context-pack";
import { AppError } from "./errors";
import { getTaskDetail, requireTaskWrite, updateTask } from "./task";

/** Bind only the material field; preserve the other handoff requirements. */
export async function bindTaskContextPack(actorId: string, projectId: string, taskId: string, packId: string | null) {
  await requireTaskWrite(actorId, projectId);
  const task = await getTaskDetail(actorId, taskId);
  if (task.projectId !== projectId) throw new AppError("任务不属于当前项目");
  if (task.status === "review" || task.status === "done") {
    throw new AppError("已进入验收或已完成的任务不可修改交接资料，请先退回修改");
  }
  if (packId) {
    const { pack } = await getContextPackForUser(actorId, packId);
    if (pack.projectId !== projectId || (pack.taskId && pack.taskId !== taskId)) {
      throw new AppError("资料包不属于当前项目或任务");
    }
    if (pack.status !== "frozen") throw new AppError("请先冻结资料包再绑定");
  }
  return updateTask(actorId, taskId, { contextPackId: packId });
}
