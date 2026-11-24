import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, users } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, listHumanMembers, listTeamMembers } from "@/lib/team";
import { createProject } from "@/lib/project";
import { claimTask, createTask, declineTask, updateTask } from "@/lib/task";
import {
  createAgent,
  deleteAgent,
  isTeamAgent,
  listProjectAgents,
  reportAgentStatus,
} from "@/lib/agent-member";
import { isAwaitingResponse } from "@/lib/task-status";
import { listProjectActivity } from "@/lib/activity-feed";
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

const CODEGEN = {
  name: "小码",
  provider: "claude-code",
  capabilities: ["写接口", "写测试"],
  maxConcurrent: 2,
};

describe("注册 agent", () => {
  beforeEach(resetDb);

  it("admin 可注册；agent 是 users 的一行，但没有密码、kind 为 agent", async () => {
    const { owner, team } = await scene();
    const a = await createAgent(owner.id, team.id, CODEGEN);

    const [row] = await db.select().from(users).where(eq(users.id, a.userId));
    expect(row.kind).toBe("agent");
    expect(row.passwordHash).toBeNull(); // 登不进来
    expect(row.email).toContain("@agents.local");

    const [ext] = await db.select().from(agents).where(eq(agents.userId, a.userId));
    expect(ext.provider).toBe("claude-code");
    expect(ext.capabilities).toEqual(["写接口", "写测试"]);
    expect(ext.status).toBe("offline");
    expect(ext.ownerId).toBe(owner.id);
  });

  it("非 admin 注册被拒", async () => {
    const { team, student } = await scene();
    await expect(createAgent(student.id, team.id, CODEGEN)).rejects.toThrow("没有权限");
  });

  it("名字与来源不可为空", async () => {
    const { owner, team } = await scene();
    await expect(createAgent(owner.id, team.id, { ...CODEGEN, name: "  " })).rejects.toThrow(
      "起个名字",
    );
    await expect(createAgent(owner.id, team.id, { ...CODEGEN, provider: "" })).rejects.toThrow(
      "跑在什么上",
    );
  });

  // agent 为了复用权限层而占了一个 team_members 席位（角色 student），
  // 但成员管理页列的是人——故 listHumanMembers 把它滤掉，
  // 而 listTeamMembers 两者都给（派活下拉要同时有它）
  it("agent 在名录里被标为 agent，且不出现在「只要人」的那份里", async () => {
    const { owner, team } = await scene();
    await createAgent(owner.id, team.id, CODEGEN);

    const all = await listTeamMembers(team.id);
    expect(all.find((m) => m.name === CODEGEN.name)?.kind).toBe("agent");

    const humans = await listHumanMembers(team.id);
    expect(humans.some((m) => m.name === CODEGEN.name)).toBe(false);
    expect(humans.some((m) => m.name === "owner")).toBe(true);
  });

  it("可被判为本团队的 agent，人则不是", async () => {
    const { owner, team, project } = await scene();
    const a = await createAgent(owner.id, team.id, CODEGEN);
    expect(await isTeamAgent(a.userId, team.id)).toBe(true);
    expect(await isTeamAgent(owner.id, team.id)).toBe(false);

    const list = await listProjectAgents(owner.id, project.id);
    expect(list.map((x) => x.userId)).toContain(a.userId);
  });
});

describe("把任务派给 agent", () => {
  beforeEach(resetDb);

  // 派下去还不算有人接：要等它自己写下承诺
  it("可指派给本团队的 agent，且初始为「待回应」", async () => {
    const { owner, team, project } = await scene();
    const agent = await createAgent(owner.id, team.id, CODEGEN);

    const t = await createTask(owner.id, project.id, {
      title: "写登录接口",
      assigneeId: agent.userId,
    });
    expect(t.assigneeId).toBe(agent.userId);
    expect(isAwaitingResponse(t.status, t.assigneeId, t.committedAt)).toBe(true);
  });

  it("不能指派给别的团队的 agent", async () => {
    const { owner, project } = await scene();
    const otherOwner = await makeUser("other@example.com");
    const otherTeam = await createTeam(otherOwner.id, "别处实验室");
    const foreign = await createAgent(otherOwner.id, otherTeam.id, CODEGEN);

    await expect(
      createTask(owner.id, project.id, { title: "甲", assigneeId: foreign.userId }),
    ).rejects.toThrow("负责人不是团队成员");
  });

  it("agent 认领后写下承诺，不再是待回应", async () => {
    const { owner, team, project } = await scene();
    const agent = await createAgent(owner.id, team.id, CODEGEN);
    const t = await createTask(owner.id, project.id, {
      title: "写登录接口",
      assigneeId: agent.userId,
    });

    const claimed = await claimTask(agent.userId, t.id, {
      commitmentNote: "先建表，再写三个端点",
      estimatedHours: 2,
    });
    expect(claimed.committedAt).not.toBeNull();
    expect(isAwaitingResponse(claimed.status, claimed.assigneeId, claimed.committedAt)).toBe(false);
  });
});

describe("接不住", () => {
  beforeEach(resetDb);

  it("退回未指派、清空承诺、记下理由", async () => {
    const { owner, team, project } = await scene();
    const agent = await createAgent(owner.id, team.id, CODEGEN);
    const t = await createTask(owner.id, project.id, {
      title: "写登录接口",
      assigneeId: agent.userId,
    });

    const declined = await declineTask(agent.userId, t.id, {
      reason: "仓库里没有可用的数据库 schema",
    });
    expect(declined.assigneeId).toBeNull();
    expect(declined.status).toBe("todo");
    expect(declined.commitmentNote).toBeNull();
    expect(declined.declineReason).toContain("没有可用的数据库 schema");
    expect(declined.declinedById).toBe(agent.userId);
  });

  it("理由必填——派活的人要据此改派", async () => {
    const { owner, team, project } = await scene();
    const agent = await createAgent(owner.id, team.id, CODEGEN);
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: agent.userId });
    await expect(declineTask(agent.userId, t.id, { reason: "  " })).rejects.toThrow("为什么接不住");
  });

  it("只有被派的人能说接不住", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await expect(declineTask(owner.id, t.id, { reason: "我不想让他做" })).rejects.toThrow(
      "只有任务负责人本人",
    );
  });

  it("记一笔 task_declined 事件，摘要含理由", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await declineTask(student.id, t.id, { reason: "这周有三门考试" });

    const feed = await listProjectActivity(owner.id, project.id);
    const e = feed.find((x) => x.type === "task_declined");
    expect(e?.summary).toContain("这周有三门考试");
    expect(e?.actorId).toBe(student.id);
  });
});

describe("改派即重置承诺", () => {
  beforeEach(resetDb);

  // 少了这一步，改派后的任务会显示「已接住」，而接手的人根本还没开口
  it("改派后回到待回应，旧承诺不跟着任务走", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await claimTask(student.id, t.id, { commitmentNote: "我来做", estimatedHours: 3 });

    const after = await updateTask(owner.id, t.id, { assigneeId: owner.id });
    expect(after.committedAt).toBeNull();
    expect(after.commitmentNote).toBeNull();
    expect(after.estimatedHours).toBeNull();
    expect(isAwaitingResponse(after.status, after.assigneeId, after.committedAt)).toBe(true);
  });

  it("改派清掉上一个人「接不住」的理由——那说的不是新负责人", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await declineTask(student.id, t.id, { reason: "这周太忙" });

    const after = await updateTask(owner.id, t.id, { assigneeId: owner.id });
    expect(after.declineReason).toBeNull();
    expect(after.declinedById).toBeNull();
  });
});

describe("agent 状态与心跳", () => {
  beforeEach(resetDb);

  it("主人可代报状态，lastSeenAt 随之刷新", async () => {
    const { owner, team } = await scene();
    const a = await createAgent(owner.id, team.id, CODEGEN);
    const updated = await reportAgentStatus(owner.id, a.userId, { status: "working" });
    expect(updated.status).toBe("working");
    expect(updated.lastSeenAt).not.toBeNull();
  });

  it("不相干的人改不了", async () => {
    const { owner, team, student } = await scene();
    const a = await createAgent(owner.id, team.id, CODEGEN);
    await expect(reportAgentStatus(student.id, a.userId, { status: "idle" })).rejects.toThrow(
      "没有权限",
    );
  });

  it("删除 agent 后其身份行随之消失", async () => {
    const { owner, team } = await scene();
    const a = await createAgent(owner.id, team.id, CODEGEN);
    await deleteAgent(owner.id, a.userId);
    expect(await db.select().from(agents).where(eq(agents.userId, a.userId))).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, a.userId))).toHaveLength(0);
  });
});
