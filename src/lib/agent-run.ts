import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, agents, tasks, type AgentRunStatus, type BlockerReason } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { recordEvent } from "./activity";
import { raiseBlocker } from "./blocker";
import { submitTask } from "./task";
import { isAwaitingResponse } from "./task-status";

// agent 的干活协议。
//
// 设计成「拉」而非「推」：agent 自己轮询 /api/agent/inbox 领活，
// 本机不需要常驻 daemon，也不必暴露端口。这与仓库既有的
// Personal API Token + /api/agent/* 是同一套路子，认证层一行没改。
//
// 一个 agent 的一天：
//   inbox 看有没有派给自己的活
//   → claim 接住（写下打算怎么做）
//   → runs 报 running
//   → 中间卡住了就报 blocked（会变成一条真正的求助，进协作推荐）
//   → 干完报 completed（自动提交待验收，由人来判）

/** 领取：派给我、且还没接住的任务。 */
export async function listAgentInbox(agentUserId: string) {
  const rows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      commitmentNote: tasks.commitmentNote,
      committedAt: tasks.committedAt,
      declineReason: tasks.declineReason,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, agentUserId), inArray(tasks.status, ["todo", "doing", "review"])))
    .orderBy(desc(tasks.priority), tasks.dueDate);

  // 分成两摞交给 agent：还没接住的、已经接住该干的
  const awaiting = rows.filter((t) => isAwaitingResponse(t.status, agentUserId, t.committedAt));
  const mine = rows.filter((t) => !isAwaitingResponse(t.status, agentUserId, t.committedAt));

  // 正在进行中的 run，供 agent 重启后恢复现场
  const running = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentUserId), inArray(agentRuns.status, ["dispatched", "running"])));

  return { awaiting, mine, running };
}

// agent 能报的五个状态。前四个对应 run 的生命周期；
// blocked 是 agent 自身的状态，不是 run 的——
// 卡住的 agent 仍在进行中，它在等，没有结束。故上报 blocked 时 run 保持 running，
// 而另落一条真正的求助。
export type AgentReportStatus = "dispatched" | "running" | "completed" | "failed" | "blocked";

/** 上报状态 → run 状态。blocked 与 running 同归，理由见上。 */
const RUN_STATUS: Record<AgentReportStatus, AgentRunStatus> = {
  dispatched: "dispatched",
  running: "running",
  completed: "completed",
  failed: "failed",
  blocked: "running",
};

export type AgentReport = {
  taskId: string;
  status: AgentReportStatus;
  /** completed 时作为交付说明；blocked 时作为卡在哪儿的补充 */
  note?: string;
  /** blocked 时的原因分类，走既有求助机制 */
  reason?: BlockerReason;
  /** blocked 时需要什么帮助 */
  helpNeeded?: string;
  /** 改了什么、产出什么，原样存进 run.result 供人查看 */
  result?: Record<string, unknown>;
};

// agent 报到。一条口子覆盖它的整个生命周期，免得 agent 侧要记五个端点。
export async function reportAgentRun(agentUserId: string, input: AgentReport) {
  const [agent] = await db.select().from(agents).where(eq(agents.userId, agentUserId));
  if (!agent) throw new ForbiddenError();

  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId));
  if (!task) throw new AppError("任务不存在");
  // 只能报自己的活
  if (task.assigneeId !== agentUserId) throw new AppError("该任务未指派给这个 agent");

  // 每报一次都算报到，避免「在跑但被误判离线」
  await touchAgent(agentUserId, input.status === "blocked" ? "blocked" : "working");

  const runStatus = RUN_STATUS[input.status];
  const run = await upsertRun(agent, input, runStatus);

  switch (input.status) {
    case "completed": {
      // 干完即提交待验收——判断做没做对的权力在人手里，agent 不能自证
      await submitTask(agentUserId, input.taskId, {
        completionNote: input.note?.trim() || "agent 已完成，详见运行记录",
      });
      await db
        .update(agents)
        .set({ status: "idle", updatedAt: sql`now()` })
        .where(eq(agents.userId, agentUserId));
      break;
    }
    case "failed": {
      // 失败不改任务状态：活还挂在它名下，等人决定重试、改派还是自己上
      await touchAgent(agentUserId, "error");
      break;
    }
    case "blocked": {
      // 卡住了会举手——直接落成一条真正的求助，
      // 于是它自动进入既有的协作推荐与健康度，不需要另造一套机制
      await raiseBlocker(agentUserId, task.projectId, {
        taskId: input.taskId,
        reason: input.reason ?? "other",
        detail: input.note,
        helpNeeded: input.helpNeeded,
      });
      break;
    }
    default:
      break;
  }

  await recordEvent(db, {
    projectId: task.projectId,
    actorId: agentUserId,
    type: "task_updated",
    taskId: input.taskId,
    summary: `agent 上报：${RUN_LABEL[input.status]}`,
    payload: { title: task.title, runStatus: input.status, note: input.note ?? null },
  });

  return run;
}

const RUN_LABEL: Record<AgentReportStatus, string> = {
  dispatched: "已接单",
  running: "正在处理",
  completed: "已完成并提交验收",
  failed: "执行失败",
  blocked: "遇到阻塞，已发出求助",
};

async function touchAgent(agentUserId: string, status: "working" | "blocked" | "error" | "idle") {
  await db
    .update(agents)
    .set({ status, lastSeenAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(agents.userId, agentUserId));
}

// 一个任务可能被跑好几趟（失败重试、换 agent 再试），
// 故优先续用已有的未结束 run，没有才新开一条。
async function upsertRun(
  agent: { userId: string },
  input: AgentReport,
  runStatus: AgentRunStatus,
) {
  const finished = runStatus === "completed" || runStatus === "failed";
  const [open] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, agent.userId),
        eq(agentRuns.taskId, input.taskId),
        inArray(agentRuns.status, ["queued", "dispatched", "running"]),
      ),
    )
    .limit(1);

  if (open) {
    const [updated] = await db
      .update(agentRuns)
      .set({
        status: runStatus,
        ...(runStatus === "dispatched" && { dispatchedAt: sql`now()` }),
        ...(runStatus === "running" && { startedAt: sql`now()` }),
        ...(finished && { finishedAt: sql`now()` }),
        ...(input.result !== undefined && { result: input.result }),
        ...(runStatus === "failed" && { error: input.note ?? "未说明原因" }),
      })
      .where(eq(agentRuns.id, open.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(agentRuns)
    .values({
      agentId: agent.userId,
      taskId: input.taskId,
      status: runStatus,
      dispatchedAt: sql`now()`,
      ...(runStatus === "running" && { startedAt: sql`now()` }),
      ...(finished && { finishedAt: sql`now()` }),
      result: input.result ?? null,
      error: runStatus === "failed" ? (input.note ?? "未说明原因") : null,
    })
    .returning();
  return created;
}

// 某任务上 agent 跑过几趟、成没成。任务卡上要显示这个——
// 「AI 在这上面试了三趟都没成」是人决定要不要自己上的关键信息。
export async function listTaskRuns(taskId: string) {
  return db
    .select({
      id: agentRuns.id,
      agentId: agentRuns.agentId,
      status: agentRuns.status,
      result: agentRuns.result,
      error: agentRuns.error,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.createdAt));
}

// 派活给 agent 时顺手排一条队，让它在 inbox 里立刻看得见
export async function enqueueRun(agentId: string, taskId: string, priority = 0) {
  const [existing] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, agentId),
        eq(agentRuns.taskId, taskId),
        inArray(agentRuns.status, ["queued", "dispatched", "running"]),
      ),
    );
  if (existing) return existing;

  const [row] = await db
    .insert(agentRuns)
    .values({ agentId, taskId, status: "queued", priority })
    .returning();
  return row;
}

// 项目里有 agent 正在办的任务。任务卡据以显示「AI 处理中」。
// 一次查完整个项目，不在卡片里逐个查——那会变成 N+1。
export async function listBusyTaskIds(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ taskId: agentRuns.taskId })
    .from(agentRuns)
    .innerJoin(tasks, eq(agentRuns.taskId, tasks.id))
    .where(
      and(
        eq(tasks.projectId, projectId),
        inArray(agentRuns.status, ["dispatched", "running"]),
      ),
    );
  return new Set(rows.map((r) => r.taskId).filter((x): x is string => Boolean(x)));
}

/** 某任务是否正有 agent 在办——卡片上显示「AI 处理中」的依据。 */
export async function activeRunForTask(taskId: string) {
  const [row] = await db
    .select({ id: agentRuns.id, agentId: agentRuns.agentId, status: agentRuns.status })
    .from(agentRuns)
    .where(and(eq(agentRuns.taskId, taskId), inArray(agentRuns.status, ["dispatched", "running"])))
    .limit(1);
  return row ?? null;
}
