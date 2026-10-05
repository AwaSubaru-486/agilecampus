import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  blockerInvites,
  blockers,
  tasks,
  users,
  type BlockerReason,
  type BlockerStatus,
} from "@/db/schema";
import { BLOCKER_REASON_LABEL, BLOCKER_STATUS_LABEL } from "./blocker-labels";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { getProjectForUser } from "./project";
import { describe, recordEvent } from "./activity";
import { notifyBlockerRaised } from "./notify";
import { requireTaskReport } from "./task";

// 文案从叶子模块取，服务端与客户端共用一份，不会各写各的。
export { BLOCKER_REASON_LABEL as blockerReasonLabel, BLOCKER_STATUS_LABEL as blockerStatusLabel };

export type RaiseBlockerInput = {
  taskId?: string | null;
  reason: BlockerReason;
  detail?: string;
  helpNeeded?: string;
  /** 协作邀请的对象。空数组＝只广播给组长与教师 */
  inviteeIds?: string[];
};

// 上报阻塞。
//
// 这是全项目门槛最低的一个动作：不强制关联任务（全局入口一键直达），
// 但 helpNeeded 强烈建议填——「我卡住了」本身不含信息，
// 队友看到这四个字也不知道该做什么。
export async function raiseBlocker(
  actorId: string,
  projectId: string,
  input: RaiseBlockerInput,
) {
  // teacher 不报自身阻塞（他不是干活的人）
  await requireTaskReport(actorId, projectId);

  if (input.taskId) {
    const [t] = await db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, input.taskId));
    if (!t) throw new AppError("任务不存在");
    if (t.projectId !== projectId) throw new AppError("任务不属于该项目");
  }

  const [blocker] = await db
    .insert(blockers)
    .values({
      projectId,
      taskId: input.taskId ?? null,
      raisedById: actorId,
      reason: input.reason,
      detail: input.detail ?? null,
      helpNeeded: input.helpNeeded ?? null,
    })
    .returning();

  let invited: string[] = [];
  if (input.inviteeIds?.length) {
    // 去重 + 排除发起人自己，唯一键冲突不致让整笔上报失败
    invited = [...new Set(input.inviteeIds)].filter((id) => id !== actorId);
    if (invited.length > 0) {
      try {
        await db.insert(blockerInvites).values(
          invited.map((inviteeId) => ({
            blockerId: blocker.id,
            inviteeId,
            invitedById: actorId,
          })),
        );
      } catch (e) {
        // 唯一键冲突＝同一人重复邀请，无害；其余错误照抛
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }

  // 通知在事件之后、返回之前发，fire-and-forget（safeSend 内部已吞异常）
  void notifyBlockerRaised({
    projectId,
    raisedById: actorId,
    reasonLabel: BLOCKER_REASON_LABEL[input.reason],
    detail: input.detail ?? null,
    helpNeeded: input.helpNeeded ?? null,
    taskId: input.taskId ?? null,
    inviteeIds: invited,
  });

  await recordEvent(db, {
    projectId,
    actorId,
    type: "blocker_raised",
    taskId: input.taskId ?? null,
    summary: describe.blockerRaised(BLOCKER_REASON_LABEL[input.reason], input.helpNeeded ?? null),
    payload: {
      reason: input.reason,
      detail: input.detail ?? null,
      helpNeeded: input.helpNeeded ?? null,
      inviteeIds: invited,
    },
  });

  return { blocker, invitedIds: invited };
}

/** 记下某人被邀请帮忙。单独暴露，供「换了个人」时补记。 */
export async function inviteHelper(blockerId: string, inviteeId: string, invitedById: string) {
  try {
    await db.insert(blockerInvites).values({ blockerId, inviteeId, invitedById });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

// 解决阻塞。任何项目成员都能点「解决了」——帮上忙的人未必是发起人，
// 也未必是被邀请的人；强行限定主体会把「我顺手帮他弄好了」这种真实情形堵死。
export async function resolveBlocker(
  actorId: string,
  blockerId: string,
  input?: { note?: string },
) {
  const [row] = await db.select().from(blockers).where(eq(blockers.id, blockerId));
  if (!row) throw new AppError("该求助不存在");
  await requireProjectAccessOrThrow(actorId, row.projectId);
  if (row.status !== "open") throw new AppError("该求助已结束");

  const [updated] = await db
    .update(blockers)
    .set({
      status: "resolved",
      resolvedById: actorId,
      resolutionNote: input?.note ?? null,
      resolvedAt: sql`now()`,
    })
    .where(and(eq(blockers.id, blockerId), eq(blockers.status, "open")))
    .returning();
  if (!updated) throw new AppError("该求助已结束");

  await recordEvent(db, {
    projectId: row.projectId,
    actorId,
    type: "blocker_resolved",
    taskId: row.taskId,
    summary: describe.blockerResolved(BLOCKER_REASON_LABEL[row.reason]),
    payload: { note: input?.note ?? null, raisedById: row.raisedById },
  });
  return updated;
}

// 撤回：发起人发现其实没卡住，或问题自己消解了
export async function cancelBlocker(actorId: string, blockerId: string) {
  const [row] = await db.select().from(blockers).where(eq(blockers.id, blockerId));
  if (!row) throw new AppError("该求助不存在");
  await requireProjectAccessOrThrow(actorId, row.projectId);
  // 只有发起人与 admin 能撤回——别人不能替你断定「你其实没卡住」
  if (row.raisedById !== actorId) {
    const access = await getProjectForUser(actorId, row.projectId);
    if (access?.role !== "admin") throw new ForbiddenError("只有发起人或组长可以撤回求助");
  }
  if (row.status !== "open") throw new AppError("该求助已结束");

  const [updated] = await db
    .update(blockers)
    .set({ status: "cancelled", resolvedById: actorId })
    .where(and(eq(blockers.id, blockerId), eq(blockers.status, "open")))
    .returning();
  if (!updated) throw new AppError("该求助已结束");
  return updated;
}

async function requireProjectAccessOrThrow(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

export type BlockerRow = {
  id: string;
  projectId: string;
  taskId: string | null;
  taskTitle: string | null;
  raisedById: string | null;
  raisedByName: string | null;
  reason: BlockerReason;
  detail: string | null;
  helpNeeded: string | null;
  status: BlockerStatus;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  createdAtMs: number;
  /** 已悬了多久（小时）。界面据此显示「已求助 2 天」 */
  ageHours: number;
};

// 同一张 users 表要 join 两次（发起人、解决人），故后一个取别名。
// 用 drizzle 的 alias() 而非手搓 SQL，类型才跟得上。
const resolver = alias(users, "resolver");

const SELECTION = {
  id: blockers.id,
  projectId: blockers.projectId,
  taskId: blockers.taskId,
  taskTitle: tasks.title,
  raisedById: blockers.raisedById,
  raisedByName: users.name,
  reason: blockers.reason,
  detail: blockers.detail,
  helpNeeded: blockers.helpNeeded,
  status: blockers.status,
  resolutionNote: blockers.resolutionNote,
  resolvedByName: resolver.name,
  resolvedAt: blockers.resolvedAt,
  createdAt: blockers.createdAt,
};

// 悬置时长由 DB 算，不用宿主机的 new Date()——与任务 updatedAt 取 now() 同源，
// 免得多实例部署时各机时钟不一，同一条求助在两人屏幕上显示不同的天数。
const AGE_HOURS = sql<number>`floor(extract(epoch from (now() - ${blockers.createdAt})) / 3600)::int`;

export async function listProjectBlockers(
  actorId: string,
  projectId: string,
  opts?: { status?: BlockerStatus[] },
): Promise<BlockerRow[]> {
  await requireProjectAccessOrThrow(actorId, projectId);

  const conds = [eq(blockers.projectId, projectId)];
  if (opts?.status?.length) conds.push(inArray(blockers.status, opts.status));

  const rows = await db
    .select({ ...SELECTION, ageHours: AGE_HOURS, createdAtMs: sql<number>`extract(epoch from ${blockers.createdAt}) * 1000` })
    .from(blockers)
    .leftJoin(tasks, eq(blockers.taskId, tasks.id))
    .leftJoin(users, eq(blockers.raisedById, users.id))
    .leftJoin(resolver, eq(blockers.resolvedById, resolver.id))
    .where(and(...conds))
    .orderBy(desc(blockers.createdAt));

  return rows.map((r) => ({ ...r, createdAtMs: Number(r.createdAtMs) }));
}

// 跨项目：所有未解决、且我有权看到的求助，按悬置时长倒序（最久的排最前）。
// 供「待我帮忙」页与健康度用。
export async function listOpenBlockersForUser(actorId: string): Promise<BlockerRow[]> {
  const rows = await db
    .select({ ...SELECTION, ageHours: AGE_HOURS, createdAtMs: sql<number>`extract(epoch from ${blockers.createdAt}) * 1000` })
    .from(blockers)
    // 必须 leftJoin tasks：全局入口上报的阻塞没有关联任务，
    // 用 innerJoin 会把它们整批漏掉——而那恰恰是最难被发现的一类求助
    .leftJoin(tasks, eq(blockers.taskId, tasks.id))
    .leftJoin(users, eq(blockers.raisedById, users.id))
    .leftJoin(resolver, eq(blockers.resolvedById, resolver.id))
    .where(eq(blockers.status, "open"))
    .orderBy(desc(blockers.createdAt));

  // 权限在应用层收口：只保留我确实在其中的项目
  const visible: BlockerRow[] = [];
  for (const r of rows) {
    const access = await getProjectForUser(actorId, r.projectId);
    if (access) visible.push({ ...r, createdAtMs: Number(r.createdAtMs) });
  }
  return visible;
}
