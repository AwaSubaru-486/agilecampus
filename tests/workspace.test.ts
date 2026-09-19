import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { claimTask, createTask, submitTask } from "@/lib/task";
import { createAgent } from "@/lib/agent-member";
import { raiseBlocker } from "@/lib/blocker";
import { buildLiveBoard } from "@/lib/workspace";
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
  return { owner, team, student, project };
}

describe("工作现场取数", () => {
  beforeEach(resetDb);

  it("列出团队成员与 AI 成员，各带自己的状态", async () => {
    const { owner, team, project } = await scene();
    await createAgent(owner.id, team.id, { name: "小码", provider: "claude-code" });

    const live = await buildLiveBoard(owner.id, project.id);
    expect(live.map((m) => m.kind).sort()).toEqual(["agent", "human", "human"]);
    const agent = live.find((m) => m.kind === "agent")!;
    expect(agent.agentStatus).toBe("offline");
  });

  // 浏览器抓到过这个：max(createdAt) 是聚合，postgres-js 给的是字符串，
  // 标成 Date 只是骗过编译器——运行时在 .getTime() 上炸。
  // 这条测试钉住「取出来的就是 Date」，别再靠标注自欺。
  it("lastAt 是 Date，不是字符串", async () => {
    const { owner, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await claimTask(owner.id, t.id, { commitmentNote: "我来" });

    const live = await buildLiveBoard(owner.id, project.id);
    const me = live.find((m) => m.id === owner.id)!;
    expect(me.lastAt).toBeInstanceOf(Date);
    expect(Number.isNaN(me.lastAt!.getTime())).toBe(false); // 可被当作日期用
  });

  it("一次都没动过的人 lastAt 为 null，而不是 Invalid Date", async () => {
    const { owner, team, project } = await scene();
    // 挂进团队但什么都不做——聚合对该人为 null，
    // 不能 new Date(null) 变成 1970 年
    const idle = await makeUser("idle@example.com");
    await joinTeam(idle.id, team.inviteCode);

    const live = await buildLiveBoard(owner.id, project.id);
    const m = live.find((x) => x.id === idle.id)!;
    expect(m.lastAt).toBeNull();
  });

  it("卡住的人排最前，且带出卡在哪", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await claimTask(student.id, t.id, { commitmentNote: "开始" });
    await raiseBlocker(student.id, project.id, {
      taskId: t.id,
      reason: "tech",
      helpNeeded: "缺一台带显卡的机器",
    });

    const live = await buildLiveBoard(owner.id, project.id);
    expect(live[0].id).toBe(student.id);
    expect(live[0].stuck).toContain("带显卡的机器");
  });

  it("派了但没回话的，计进 awaitingCount", async () => {
    const { owner, student, project } = await scene();
    await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });

    const live = await buildLiveBoard(owner.id, project.id);
    const s = live.find((m) => m.id === student.id)!;
    expect(s.awaitingCount).toBe(1);
    expect(s.taskId).toBeNull(); // 还没接住，不算「在做」
  });

  it("非成员读不到", async () => {
    const { project } = await scene();
    const outsider = await makeUser("outsider@example.com");
    await expect(buildLiveBoard(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});

describe("行动队列的取数", () => {
  beforeEach(resetDb);

  it("派给我、我还没回话的算行动；已接住的不算", async () => {
    const { owner, student, project } = await scene();
    const a = await createTask(owner.id, project.id, { title: "待回应的", assigneeId: student.id });
    const b = await createTask(owner.id, project.id, { title: "已接住的", assigneeId: student.id });
    await claimTask(student.id, b.id, { commitmentNote: "我来" });

    const { loadActionQueue } = await import("@/lib/shell");
    const { items } = await loadActionQueue(student.id);
    expect(items.map((x) => x.taskId)).toContain(a.id);
    expect(items.map((x) => x.taskId)).not.toContain(b.id);
  });

  it("组长看得到待验收，学生看不到", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await claimTask(student.id, t.id, { commitmentNote: "我来" });
    await submitTask(student.id, t.id, { completionNote: "好了" });

    const { loadActionQueue } = await import("@/lib/shell");
    const asOwner = await loadActionQueue(owner.id);
    const asStudent = await loadActionQueue(student.id);
    expect(asOwner.items.some((x) => x.kind === "review" && x.taskId === t.id)).toBe(true);
    expect(asStudent.items.some((x) => x.kind === "review")).toBe(false);
  });

  it("已接住且过期的，以「逾期」出现，并带上截止日", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, {
      title: "过期的",
      assigneeId: student.id,
      dueDate: "2020-01-01",
    });
    // 必须先接住：否则它会以更急的「待回应」出现——
    // 那是同一件事的另一种说法，去重时留最急的那条
    await claimTask(student.id, t.id, { commitmentNote: "我来" });

    const { loadActionQueue } = await import("@/lib/shell");
    const { items } = await loadActionQueue(student.id);
    const overdue = items.find((x) => x.kind === "overdue");
    expect(overdue?.context).toContain("2020-01-01");
  });

  // 同一件事绝不在队列里出现两次——被退回的活往往同时也逾期
  it("同时逾期又被退回的任务只出现一次", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, {
      title: "又逾期又被退回",
      assigneeId: student.id,
      dueDate: "2020-01-01",
    });
    await claimTask(student.id, t.id, { commitmentNote: "我来" });
    await submitTask(student.id, t.id, { completionNote: "好了" });
    const { reviewTask } = await import("@/lib/task");
    await reviewTask(owner.id, t.id, { decision: "reject", note: "太粗" });

    const { loadActionQueue } = await import("@/lib/shell");
    const { items } = await loadActionQueue(student.id);
    expect(items.filter((x) => x.taskId === t.id)).toHaveLength(1);
    expect(items.find((x) => x.taskId === t.id)?.kind).toBe("rejected_work");
  });

  // 徽章与今日页必须同源——验收报告 P1-3 指出的正是这个：
  // 徽章只数待回应，今日页却还列了待验收，同一屏两个数字互相打脸
  it("徽章数字与队列总数一致", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await claimTask(student.id, t.id, { commitmentNote: "我来" });
    await submitTask(student.id, t.id, { completionNote: "好了" });

    const { loadActionQueue, countMyPendingActions } = await import("@/lib/shell");
    const queue = await loadActionQueue(owner.id, { showAll: true });
    expect(await countMyPendingActions(owner.id)).toBe(queue.total);
  });

  // 归档项目已经结束，不该再追着人跑——否则半年前的逾期会永久占着队列
  it("归档项目不进队列", async () => {
    const { owner, student, project } = await scene();
    await createTask(owner.id, project.id, {
      title: "归档项目里的逾期",
      assigneeId: student.id,
      dueDate: "2020-01-01",
    });
    const { updateProject } = await import("@/lib/project");
    await updateProject(owner.id, project.id, { status: "archived" });

    const { loadActionQueue } = await import("@/lib/shell");
    const { items } = await loadActionQueue(student.id);
    expect(items).toHaveLength(0);
  });

  it("不在任何团队时返回空，不报错", async () => {
    const lonely = await makeUser("lonely@example.com");
    const { loadActionQueue } = await import("@/lib/shell");
    expect(await loadActionQueue(lonely.id)).toEqual({ items: [], omitted: 0, total: 0 });
  });
});
