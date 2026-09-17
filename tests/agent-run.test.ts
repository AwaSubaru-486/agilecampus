import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { claimTask, createTask, listProjectTasks, submitTask } from "@/lib/task";
import { createAgent } from "@/lib/agent-member";
import { listAgentInbox, listTaskRuns, reportAgentRun } from "@/lib/agent-run";
import { listProjectBlockers } from "@/lib/blocker";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  const agent = await createAgent(owner.id, team.id, {
    name: "小码",
    provider: "claude-code",
    capabilities: ["写接口"],
  });
  return { owner, team, student, project, agent };
}

const agentStatusOf = async (id: string) =>
  (await db.select().from(agents).where(eq(agents.userId, id)))[0].status;

describe("inbox —— agent 领取活", () => {
  beforeEach(resetDb);

  it("把「还没接住」与「已经接住」分成两摞", async () => {
    const { owner, project, agent } = await scene();
    const a = await createTask(owner.id, project.id, { title: "写登录接口", assigneeId: agent.userId });
    const b = await createTask(owner.id, project.id, { title: "写测试", assigneeId: agent.userId });
    await claimTask(agent.userId, b.id, { commitmentNote: "照着接口写" });

    const inbox = await listAgentInbox(agent.userId);
    expect(inbox.awaiting.map((t) => t.id)).toEqual([a.id]);
    expect(inbox.mine.map((t) => t.id)).toEqual([b.id]);
  });

  it("只看得到派给自己的活", async () => {
    const { owner, student, project, agent } = await scene();
    await createTask(owner.id, project.id, { title: "别人的活", assigneeId: student.id });
    const inbox = await listAgentInbox(agent.userId);
    expect(inbox.awaiting).toHaveLength(0);
  });
});

describe("上报执行状态", () => {
  beforeEach(resetDb);

  it("running → agent 转为 working，run 记下开始时刻", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });

    const run = await reportAgentRun(agent.userId, { taskId: t.id, status: "running" });
    expect(run.status).toBe("running");
    expect(run.startedAt).not.toBeNull();
    expect(await agentStatusOf(agent.userId)).toBe("working");
  });

  // 「agent 卡住了会举手」——直接落成一条真正的求助，
  // 于是它自动进入既有的协作推荐与健康度，不必另造一套机制
  it("blocked → 落成一条真求助，agent 转为 blocked，run 仍是 running", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });

    const run = await reportAgentRun(agent.userId, {
      taskId: t.id,
      status: "blocked",
      reason: "tech",
      note: "构建脚本里没有测试命令",
      helpNeeded: "想让人确认一下该跑哪条命令",
    });

    // 卡住的 agent 仍在进行中：它在等，没有结束
    expect(run.status).toBe("running");
    expect(await agentStatusOf(agent.userId)).toBe("blocked");

    const blockers = await listProjectBlockers(owner.id, project.id, { status: ["open"] });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].raisedById).toBe(agent.userId);
    expect(blockers[0].helpNeeded).toContain("该跑哪条命令");
  });

  // agent 不能自证完成：completed 只意味着「我交了」，判断在人手里
  it("completed → 任务落入待验收，agent 回到 idle", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await claimTask(agent.userId, t.id, { commitmentNote: "先建表" });

    const run = await reportAgentRun(agent.userId, {
      taskId: t.id,
      status: "completed",
      note: "三个端点都写好了，附测试",
    });
    expect(run.status).toBe("completed");
    expect(run.finishedAt).not.toBeNull();
    expect(await agentStatusOf(agent.userId)).toBe("idle");

    const [task] = await listProjectTasks(owner.id, project.id);
    expect(task.status).toBe("review"); // 待验收，不是 done
    expect(task.completionNote).toContain("三个端点都写好了");
  });

  it("failed → agent 转 error，任务仍挂在它名下等人定夺", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });

    const run = await reportAgentRun(agent.userId, {
      taskId: t.id,
      status: "failed",
      note: "编译不过，改了三次都不行",
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("编译不过");
    expect(await agentStatusOf(agent.userId)).toBe("error");

    const [task] = await listProjectTasks(owner.id, project.id);
    expect(task.status).not.toBe("done");
    expect(task.assigneeId).toBe(agent.userId);
  });

  // 一趟就是一趟：失败后重试另开一条，这样任务卡上能如实显示
  // 「AI 在这上面试了三趟」——合并成一条就看不出试过几次了
  it("失败后重试算新的一趟，不并进上一条", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "running" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "failed", note: "第一次挂了" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "running" });

    const runs = await listTaskRuns(t.id);
    expect(runs).toHaveLength(2);
    expect(runs.some((r) => r.status === "failed")).toBe(true);
    expect(runs.some((r) => r.status === "running")).toBe(true);
  });

  // 同一趟里反复报到（running → blocked → running）不该长出多条
  it("同一趟里反复报到只留一条", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "running" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "blocked", reason: "tech" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "running" });

    const runs = await listTaskRuns(t.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("running");
  });

  it("报不了别人的活", async () => {
    const { owner, student, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await expect(
      reportAgentRun(agent.userId, { taskId: t.id, status: "running" }),
    ).rejects.toThrow("未指派给这个 agent");
  });

  it("非 agent 的令牌报到会被拒", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await expect(
      reportAgentRun(owner.id, { taskId: t.id, status: "running" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("人在环中：agent 交的活仍要人验收", () => {
  beforeEach(resetDb);

  it("agent 完成 → 组长通过 → 才算做完", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "写登录接口", assigneeId: agent.userId });
    await claimTask(agent.userId, t.id, { commitmentNote: "先建表再写端点" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "completed", note: "写好了" });

    const { reviewTask } = await import("@/lib/task");
    const done = await reviewTask(owner.id, t.id, { decision: "accept" });
    expect(done.status).toBe("done");
    expect(done.reviewedById).toBe(owner.id);
  });

  it("人可以直接退 agent 的活，且理由必填", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await claimTask(agent.userId, t.id, { commitmentNote: "开始" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "completed", note: "好了" });

    const { reviewTask } = await import("@/lib/task");
    await expect(reviewTask(owner.id, t.id, { decision: "reject" })).rejects.toThrow(
      "请写明需要改什么",
    );
    const back = await reviewTask(owner.id, t.id, { decision: "reject", note: "没写测试" });
    expect(back.status).toBe("doing");
    expect(back.rejectCount).toBe(1);
  });

  it("agent 无验收权", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await claimTask(agent.userId, t.id, { commitmentNote: "开始" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "completed", note: "好了" });

    const { reviewTask } = await import("@/lib/task");
    await expect(reviewTask(agent.userId, t.id, { decision: "accept" })).rejects.toThrow(
      "只有组长或教师",
    );
  });
});

describe("任务卡要显示的：agent 在这上面试了几趟", () => {
  beforeEach(resetDb);

  it("跑过的不止一趟时都留着", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "completed", note: "第一版" });
    // 退回后 agent 再跑一趟
    const { reviewTask } = await import("@/lib/task");
    await reviewTask(owner.id, t.id, { decision: "reject", note: "太粗" });
    await reportAgentRun(agent.userId, { taskId: t.id, status: "running" });

    const runs = await listTaskRuns(t.id);
    expect(runs.length).toBe(2);
    expect(runs.some((r) => r.status === "completed")).toBe(true);
    expect(runs.some((r) => r.status === "running")).toBe(true);
  });
});

// submitTask 直调路径也走一遍，确保 agent 用 complete 端点时口径一致
describe("agent 直接调提交端点", () => {
  beforeEach(resetDb);

  it("提交后落 review，与 runs 的 completed 同口径", async () => {
    const { owner, project, agent } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await claimTask(agent.userId, t.id, { commitmentNote: "开始" });
    const u = await submitTask(agent.userId, t.id, { completionNote: "直接从端点交" });
    expect(u.status).toBe("review");
  });
});
