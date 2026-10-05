import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createMilestone, createProject } from "@/lib/project";
import { claimTask, createTask, reviewTask, submitTask } from "@/lib/task";
import { createAgent } from "@/lib/agent-member";
import { raiseBlocker, resolveBlocker } from "@/lib/blocker";
import {
  extractHighlights,
  listMilestoneProgress,
  syncMilestoneAchievement,
} from "@/lib/milestone";
import { resetDb } from "./helpers";

const HOUR = 3_600_000;

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  const agent = await createAgent(owner.id, team.id, { name: "小码", provider: "claude-code" });
  return { owner, team, student, project, agent };
}

function taskRow(over: Partial<Parameters<typeof extractHighlights>[0]> = {}) {
  return {
    id: "t1",
    title: "写接口",
    status: "done",
    assigneeId: "u1",
    assigneeName: "周瑜",
    assigneeKind: "human" as const,
    dueDate: null,
    committedAt: null,
    submittedAt: null,
    reviewedAt: null,
    estimatedHours: null,
    rejectCount: 0,
    ...over,
  };
}

describe("高光提取（纯函数）", () => {
  const ctx = { wasBlockedAndResolved: false, isFirstDelivery: false };

  // 大多数任务是顺顺当当做完的，那本就不该在功勋墙上占一格
  it("平平无奇地做完，什么都不记", () => {
    expect(extractHighlights(taskRow(), ctx)).toEqual([]);
  });

  it("未完成的任务不提取", () => {
    expect(extractHighlights(taskRow({ status: "doing" }), ctx)).toEqual([]);
  });

  it("AI 交付要记一笔", () => {
    const out = extractHighlights(
      taskRow({ assigneeName: "小码", assigneeKind: "agent" }),
      ctx,
    );
    expect(out[0].kind).toBe("delivered_by_agent");
    expect(out[0].note).toContain("小码");
    expect(out[0].note).toContain("AI");
  });

  it("被退回过要记一笔，且写清几次", () => {
    const out = extractHighlights(taskRow({ rejectCount: 2 }), ctx);
    expect(out[0].kind).toBe("reworked");
    expect(out[0].note).toContain("2 次");
  });

  // 这条守护一个已经做过的决定，而不是一个功能。
  //
  // 曾有一条「实际耗时超出预估」的规则，写了又删：它拿「认领到交付的
  // 挂钟时间」当「实际投入」，而任务在那儿放着七天不等于干了七天。
  // 贡献记录里已把「实际投入时长」列为量不到的维度，此处若拿它当规则
  // 就是自相矛盾。谁日后想把它加回来，先读这段，再看这条测试为什么红。
  it("不拿挂钟时间冒充实际投入——测得再久也不记这一笔", () => {
    const committedAt = new Date(Date.UTC(2026, 8, 1, 0, 0, 0));
    const out = extractHighlights(
      taskRow({
        committedAt,
        estimatedHours: 2,
        submittedAt: new Date(committedAt.getTime() + 200 * HOUR), // 跨了八天
      }),
      ctx,
    );
    expect(out).toEqual([]);
  });

  it("卡过又解决要记一笔", () => {
    const out = extractHighlights(taskRow(), { ...ctx, wasBlockedAndResolved: true });
    expect(out[0].kind).toBe("unblocked");
  });

  // 用交付那一刻对照截止日，而不是「今天」——
  // 否则一件按时完成的任务会随着时间流逝变成「逾期」
  it("逾期完成按交付时刻算，不随日子流逝而改变", () => {
    const out = extractHighlights(
      taskRow({
        dueDate: "2026-09-01",
        submittedAt: new Date(Date.UTC(2026, 8, 4, 10, 0, 0)),
      }),
      ctx,
    );
    const late = out.find((x) => x.kind === "late_done");
    expect(late?.note).toContain("3 天");
  });

  it("按时完成不记逾期，哪怕今天已经很晚", () => {
    const out = extractHighlights(
      taskRow({
        dueDate: "2030-01-01",
        submittedAt: new Date(Date.UTC(2026, 8, 4, 10, 0, 0)),
      }),
      ctx,
    );
    expect(out.map((x) => x.kind)).not.toContain("late_done");
  });

  it("首件交付要记一笔", () => {
    const out = extractHighlights(taskRow(), { ...ctx, isFirstDelivery: true });
    expect(out[0].kind).toBe("first_delivery");
  });

  it("一件事可以同时占好几格", () => {
    const out = extractHighlights(
      taskRow({ assigneeKind: "agent", assigneeName: "小码", rejectCount: 1 }),
      { wasBlockedAndResolved: true, isFirstDelivery: false },
    );
    expect(out.map((x) => x.kind).sort()).toEqual(
      ["delivered_by_agent", "reworked", "unblocked"].sort(),
    );
  });
});

describe("里程碑自动记录（落库）", () => {
  beforeEach(resetDb);

  it("任务全做完 → 自动达成，并把实况冻结进摘要", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const t = await createTask(owner.id, project.id, {
      title: "写接口",
      assigneeId: student.id,
      milestoneId: m.id,
    });
    await claimTask(student.id, t.id, { commitmentNote: "先建表" });
    await submitTask(student.id, t.id, { completionNote: "好了" });

    // 还没验收，不算达成
    let changed = await syncMilestoneAchievement(owner.id, project.id);
    expect(changed).toBe(0);

    await reviewTask(owner.id, t.id, { decision: "accept" });
    changed = await syncMilestoneAchievement(owner.id, project.id);
    expect(changed).toBe(1);

    const [progress] = await listMilestoneProgress(owner.id, project.id);
    expect(progress.status).toBe("done");
    expect(progress.achievedAt).not.toBeNull();
    expect(progress.autoSummary).toContain("共完成 1 项");
  });

  it("只做了一半不算达成，且列出还差谁", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id, milestoneId: m.id });
    await createTask(owner.id, project.id, { title: "乙", assigneeId: student.id, milestoneId: m.id });

    const [progress] = await listMilestoneProgress(owner.id, project.id);
    expect(progress.status).toBe("open");
    expect(progress.total).toBe(2);
    expect(progress.done).toBe(0);
    expect(progress.remaining).toHaveLength(2);
  });

  // 否则新建的空里程碑会立刻自己点亮
  it("没有任务的里程碑永不自动达成", async () => {
    const { owner, project } = await scene();
    await createMilestone(owner.id, project.id, { title: "空的" });
    const changed = await syncMilestoneAchievement(owner.id, project.id);
    expect(changed).toBe(0);

    const [progress] = await listMilestoneProgress(owner.id, project.id);
    expect(progress.status).toBe("open");
  });

  it("AI 交付的活，高光自动落在里程碑上——人一格没填", async () => {
    const { owner, project, agent } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const t = await createTask(owner.id, project.id, {
      title: "写接口",
      assigneeId: agent.userId,
      milestoneId: m.id,
    });
    await claimTask(agent.userId, t.id, { commitmentNote: "先建表" });
    await reportCompleted(agent.userId, t.id);
    await reviewTask(owner.id, t.id, { decision: "accept" });

    await syncMilestoneAchievement(owner.id, project.id);
    const [progress] = await listMilestoneProgress(owner.id, project.id);
    const kinds = progress.highlights.map((h) => h.kind);
    expect(kinds).toContain("delivered_by_agent");
    expect(progress.highlights[0].actorKind).toBe("agent");
  });

  it("卡过又解决的任务，里程碑上留一笔", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const t = await createTask(owner.id, project.id, {
      title: "甲",
      assigneeId: student.id,
      milestoneId: m.id,
    });
    const { blocker } = await raiseBlocker(student.id, project.id, {
      taskId: t.id,
      reason: "tech",
    });
    await resolveBlocker(student.id, blocker.id, { note: "问到了" });

    await claimTask(student.id, t.id, { commitmentNote: "继续" });
    await submitTask(student.id, t.id, { completionNote: "好了" });
    await reviewTask(owner.id, t.id, { decision: "accept" });

    await syncMilestoneAchievement(owner.id, project.id);
    const [progress] = await listMilestoneProgress(owner.id, project.id);
    expect(progress.highlights.map((h) => h.kind)).toContain("unblocked");
  });

  it("反复同步不会记重（唯一索引拦着）", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const t = await createTask(owner.id, project.id, {
      title: "甲",
      assigneeId: student.id,
      milestoneId: m.id,
    });
    await claimTask(student.id, t.id, { commitmentNote: "开始" });
    await submitTask(student.id, t.id, { completionNote: "好了" });
    await reviewTask(owner.id, t.id, { decision: "accept" });

    const a = await listMilestoneProgress(owner.id, project.id);
    const b = await listMilestoneProgress(owner.id, project.id);
    const c = await listMilestoneProgress(owner.id, project.id);
    expect(a[0].highlights.length).toBe(b[0].highlights.length);
    expect(b[0].highlights.length).toBe(c[0].highlights.length);
  });

  it("达成后不重复标记", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const t = await createTask(owner.id, project.id, {
      title: "甲",
      assigneeId: student.id,
      milestoneId: m.id,
    });
    await claimTask(student.id, t.id, { commitmentNote: "开始" });
    await submitTask(student.id, t.id, { completionNote: "好了" });
    await reviewTask(owner.id, t.id, { decision: "accept" });

    expect(await syncMilestoneAchievement(owner.id, project.id)).toBe(1);
    expect(await syncMilestoneAchievement(owner.id, project.id)).toBe(0);
  });

  it("项目第一件交付会被标出来", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const first = await createTask(owner.id, project.id, {
      title: "先做的",
      assigneeId: student.id,
      milestoneId: m.id,
    });
    await claimTask(student.id, first.id, { commitmentNote: "开始" });
    await submitTask(student.id, first.id, { completionNote: "好了" });
    await reviewTask(owner.id, first.id, { decision: "accept" });

    await syncMilestoneAchievement(owner.id, project.id);
    const [progress] = await listMilestoneProgress(owner.id, project.id);
    expect(progress.highlights.map((h) => h.kind)).toContain("first_delivery");
  });

  it("非成员读不到", async () => {
    const { project } = await scene();
    const outsider = await makeUser("outsider@example.com");
    await expect(listMilestoneProgress(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});

describe("人工仍可关开，但要留一句为什么", () => {
  beforeEach(resetDb);

  it("admin 可手动标记达成并附理由", async () => {
    const { owner, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const { setMilestoneStatus } = await import("@/lib/milestone");
    const updated = await setMilestoneStatus(owner.id, m.id, "done", "学院临时调整，提前结项");
    expect(updated.status).toBe("done");
    expect(updated.autoSummary).toContain("学院临时调整");
  });

  it("非 admin 改不了", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const { setMilestoneStatus } = await import("@/lib/milestone");
    await expect(setMilestoneStatus(student.id, m.id, "done")).rejects.toThrow("没有权限");
  });

  // 自动判定是默认，不是牢笼；但人工关掉要留一句为什么
  it("人工标记会覆盖自动摘要，写明是谁改的", async () => {
    const { owner, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const { setMilestoneStatus } = await import("@/lib/milestone");
    const updated = await setMilestoneStatus(owner.id, m.id, "done", "学院提前结项");
    expect(updated.autoSummary).toMatch(/^人工标记：/);
    expect(updated.achievedAt).not.toBeNull();
  });

  it("人工重开会把达成时刻清掉", async () => {
    const { owner, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "一期" });
    const { setMilestoneStatus } = await import("@/lib/milestone");
    await setMilestoneStatus(owner.id, m.id, "done", "先标上");
    const reopened = await setMilestoneStatus(owner.id, m.id, "open");
    expect(reopened.status).toBe("open");
    expect(reopened.achievedAt).toBeNull();
  });
});

// agent 走既有协议交活
async function reportCompleted(agentUserId: string, taskId: string) {
  const { reportAgentRun } = await import("@/lib/agent-run");
  await reportAgentRun(agentUserId, { taskId, status: "completed", note: "好了" });
}
