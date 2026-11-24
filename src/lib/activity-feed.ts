import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, users, type ActivityType } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import type { ActivityRow } from "./activity";

// 活动流的读取侧。与 lib/activity.ts（写入侧）分家，是为了断开 project ↔ activity 的循环：
// 写入侧被 project.ts 引用，读取侧反过来引用 project.ts 的 getProjectForUser 做权限收敛。

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// 项目活动流（倒序）。权限走既有的 getProjectForUser，与任务/里程碑同源。
export async function listProjectActivity(
  actorId: string,
  projectId: string,
  opts?: {
    limit?: number;
    types?: ActivityType[];
    actorId?: string;
    taskId?: string;
  },
): Promise<ActivityRow[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const conds = [eq(activityEvents.projectId, projectId)];
  if (opts?.types?.length) conds.push(inArray(activityEvents.type, opts.types));
  if (opts?.actorId) conds.push(eq(activityEvents.actorId, opts.actorId));
  if (opts?.taskId) conds.push(eq(activityEvents.taskId, opts.taskId));

  return db
    .select({
      id: activityEvents.id,
      type: activityEvents.type,
      summary: activityEvents.summary,
      taskId: activityEvents.taskId,
      actorId: activityEvents.actorId,
      // leftJoin：actor 被删后 actorId 置 null，事件仍须可读可渲染
      actorName: users.name,
      actorKind: users.kind,
      payload: activityEvents.payload,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .leftJoin(users, eq(activityEvents.actorId, users.id))
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt))
    .limit(Math.min(opts?.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
}
