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

describe("今日行动队列的取数", () => {
  beforeEach(resetDb);

  it("派给我、我还没回话的算行动；已接住的不算", async () => {
    const { owner, student, project } = await scene();
    const a = await createTask(owner.id, project.id, { title: "待回应的", assigneeId: student.id });
    const b = await createTask(owner.id, project.id, { title: "已接住的", assigneeId: student.id });
    await claimTask(student.id, b.id, { commitmentNote: "我来" });

    const { listMyActionItems } = await import("@/lib/shell");
    const { awaiting } = await listMyActionItems(student.id);
    expect(awaiting.map((x) => x.taskId)).toEqual([a.id]);
  });

  it("组长看得到待验收，学生看不到", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await claimTask(student.id, t.id, { commitmentNote: "我来" });
    await submitTask(student.id, t.id, { completionNote: "好了" });

    const { listMyActionItems } = await import("@/lib/shell");
    const asOwner = await listMyActionItems(owner.id);
    const asStudent = await listMyActionItems(student.id);
    expect(asOwner.toReview.map((x) => x.taskId)).toEqual([t.id]);
    expect(asStudent.toReview).toEqual([]);
  });

  it("逾期标记按截止日算", async () => {
    const { owner, student, project } = await scene();
    await createTask(owner.id, project.id, {
      title: "过期的",
      assigneeId: student.id,
      dueDate: "2020-01-01",
    });

    const { listMyActionItems } = await import("@/lib/shell");
    const { awaiting } = await listMyActionItems(student.id);
    expect(awaiting[0].overdue).toBe(true);
  });

  it("不在任何团队时返回空，不报错", async () => {
    const lonely = await makeUser("lonely@example.com");
    const { listMyActionItems } = await import("@/lib/shell");
    expect(await listMyActionItems(lonely.id)).toEqual({ awaiting: [], toReview: [] });
  });
});
