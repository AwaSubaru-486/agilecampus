import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { blockers } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, deleteTask, updateTask } from "@/lib/task";
import {
  cancelBlocker,
  listOpenBlockersForUser,
  listProjectBlockers,
  raiseBlocker,
  resolveBlocker,
} from "@/lib/blocker";
import { suggestHelpers } from "@/lib/collaboration";
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
  const mate = await makeUser("mate@example.com");
  await joinTeam(mate.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, mate, teacher, outsider, project };
}

describe("raiseBlocker —— 上报", () => {
  beforeEach(resetDb);

  // 全局悬浮入口不强制先找到任务，故无关联任务的上报必须成立
  it("不关联任务也能上报", async () => {
    const { student, project } = await scene();
    const { blocker } = await raiseBlocker(student.id, project.id, {
      reason: "unclear",
      detail: "不知道该先做哪一块",
      helpNeeded: "希望有人帮我定个优先级",
    });
    expect(blocker.taskId).toBeNull();
    expect(blocker.status).toBe("open");
    expect(blocker.raisedById).toBe(student.id);
  });

  it("带任务上报时记下任务是哪一个", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    const { blocker } = await raiseBlocker(student.id, project.id, {
      taskId: t.id,
      reason: "tech",
      detail: "模型跑不收敛",
    });
    expect(blocker.taskId).toBe(t.id);
  });

  // 否则可以把 A 项目的阻塞挂到 B 项目的任务上，健康度会串味
  it("任务不属于该项目时被拒", async () => {
    const { owner, team, student, project } = await scene();
    const otherProject = await createProject(owner.id, team.id, { name: "另一个项目" });
    const foreign = await createTask(owner.id, otherProject.id, { title: "别处的任务" });
    await expect(
      raiseBlocker(student.id, project.id, { taskId: foreign.id, reason: "tech" }),
    ).rejects.toThrow("任务不属于该项目");
  });

  it("teacher 不报自身阻塞", async () => {
    const { teacher, project } = await scene();
    await expect(
      raiseBlocker(teacher.id, project.id, { reason: "time" }),
    ).rejects.toThrow("没有权限");
  });

  it("非团队成员报不了", async () => {
    const { outsider, project } = await scene();
    await expect(
      raiseBlocker(outsider.id, project.id, { reason: "time" }),
    ).rejects.toThrow("没有权限");
  });

  // 「我卡住了」四个字本身不含信息，队友看到也不知道该做什么
  it("摘要里带上所需帮助", async () => {
    const { student, project } = await scene();
    await raiseBlocker(student.id, project.id, {
      reason: "resource",
      helpNeeded: "借一台带显卡的机器",
    });
    const feed = await listProjectActivity(student.id, project.id);
    const raised = feed.find((e) => e.type === "blocker_raised");
    expect(raised?.summary).toContain("借一台带显卡的机器");
    expect(raised?.summary).toContain("缺资源或设备");
  });

  it("邀请同伴时去重且不含发起人自己", async () => {
    const { student, mate, project } = await scene();
    const { invitedIds } = await raiseBlocker(student.id, project.id, {
      reason: "tech",
      inviteeIds: [mate.id, mate.id, student.id],
    });
    expect(invitedIds).toEqual([mate.id]);
  });

  it("缺席省邀请人也能上报（只广播给组长与教师）", async () => {
    const { student, project } = await scene();
    const { invitedIds } = await raiseBlocker(student.id, project.id, { reason: "other" });
    expect(invitedIds).toEqual([]);
  });
});

describe("resolveBlocker / cancelBlocker", () => {
  beforeEach(resetDb);

  // 帮上忙的人未必是发起人，「我顺手帮他弄好了」是真实情形
  it("任何项目成员都能点已解决，并记下是谁解的", async () => {
    const { student, mate, project } = await scene();
    const { blocker } = await raiseBlocker(student.id, project.id, { reason: "tech" });
    const done = await resolveBlocker(mate.id, blocker.id, { note: "我这边有现成脚本，给他了" });
    expect(done.status).toBe("resolved");
    expect(done.resolvedById).toBe(mate.id);
    expect(done.resolvedAt).not.toBeNull();
  });

  it("已结束的不能再解一次", async () => {
    const { student, project } = await scene();
    const { blocker } = await raiseBlocker(student.id, project.id, { reason: "tech" });
    await resolveBlocker(student.id, blocker.id);
    await expect(resolveBlocker(student.id, blocker.id)).rejects.toThrow("已结束");
  });

  it("非成员解不了", async () => {
    const { student, outsider, project } = await scene();
    const { blocker } = await raiseBlocker(student.id, project.id, { reason: "tech" });
    await expect(resolveBlocker(outsider.id, blocker.id)).rejects.toThrow("没有权限");
  });

  // 别人不能替你断定「你其实没卡住」
  it("只有发起人或组长能撤回", async () => {
    const { student, mate, owner, project } = await scene();
    const a = await raiseBlocker(student.id, project.id, { reason: "time" });
    await expect(cancelBlocker(mate.id, a.blocker.id)).rejects.toThrow("只有发起人或组长");

    const b = await raiseBlocker(student.id, project.id, { reason: "time" });
    const cancelled = await cancelBlocker(owner.id, b.blocker.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("解决记一笔 blocker_resolved 事件", async () => {
    const { student, mate, project } = await scene();
    const { blocker } = await raiseBlocker(student.id, project.id, { reason: "tech" });
    await resolveBlocker(mate.id, blocker.id, { note: "给了脚本" });
    const feed = await listProjectActivity(student.id, project.id);
    const resolved = feed.find((e) => e.type === "blocker_resolved");
    expect(resolved?.actorId).toBe(mate.id);
    expect(resolved?.payload).toMatchObject({ raisedById: student.id });
  });
});

describe("查询与权限", () => {
  beforeEach(resetDb);

  it("非成员读不到项目内的求助", async () => {
    const { student, outsider, project } = await scene();
    await raiseBlocker(student.id, project.id, { reason: "tech" });
    await expect(listProjectBlockers(outsider.id, project.id)).rejects.toThrow("没有权限");
  });

  it("可按状态筛", async () => {
    const { student, project } = await scene();
    const a = await raiseBlocker(student.id, project.id, { reason: "tech" });
    await raiseBlocker(student.id, project.id, { reason: "time" });
    await resolveBlocker(student.id, a.blocker.id);

    const open = await listProjectBlockers(student.id, project.id, { status: ["open"] });
    expect(open).toHaveLength(1);
    expect(open[0].reason).toBe("time");
  });

  // 全局入口上报的阻塞没有 taskId，用 innerJoin 会整批漏掉——
  // 而那恰恰是最难被发现的一类求助。这条是防它回归的。
  it("跨项目列表含无关联任务的求助", async () => {
    const { student, project } = await scene();
    await raiseBlocker(student.id, project.id, { reason: "unclear", helpNeeded: "帮我定优先级" });
    const mine = await listOpenBlockersForUser(student.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].taskId).toBeNull();
    expect(mine[0].helpNeeded).toBe("帮我定优先级");
  });

  it("跨项目列表只含自己团队的项目，他人的一概不出现", async () => {
    const { student, project } = await scene();
    await raiseBlocker(student.id, project.id, { reason: "tech" });

    // 另起一个与我毫无关系的团队与项目，里面也有人求助
    const strangerOwner = await makeUser("stranger@example.com");
    const strangerTeam = await createTeam(strangerOwner.id, "别处实验室");
    const strangerProject = await createProject(strangerOwner.id, strangerTeam.id, {
      name: "别人的项目",
    });
    await raiseBlocker(strangerOwner.id, strangerProject.id, { reason: "tech" });

    const mine = await listOpenBlockersForUser(student.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].projectId).toBe(project.id);
  });

  it("不在任何团队的人看不到任何求助", async () => {
    const { student, outsider, project } = await scene();
    await raiseBlocker(student.id, project.id, { reason: "tech" });
    expect(await listOpenBlockersForUser(outsider.id)).toEqual([]);
  });

  // cascade 而非 set null：留着会变成永远 open 却无所指的阻塞
  it("删掉任务，挂在它上面的求助随之消失", async () => {
    const { owner, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await raiseBlocker(owner.id, project.id, { taskId: t.id, reason: "tech" });
    expect(await db.select().from(blockers)).toHaveLength(1);

    await deleteTask(owner.id, t.id);
    expect(await db.select().from(blockers)).toHaveLength(0);
  });
});

describe("suggestHelpers —— 取数壳", () => {
  beforeEach(resetDb);

  it("排除发起人自己与教师", async () => {
    const { student, mate, teacher, project } = await scene();
    const out = await suggestHelpers(student.id, {
      projectId: project.id,
      taskId: null,
      reason: "tech",
    });
    const ids = out.map((s) => s.userId);
    expect(ids).not.toContain(student.id);
    expect(ids).not.toContain(teacher.id);
    expect(ids).toContain(mate.id);
  });

  it("无任何历史时仍给出候选（冷启动不空）", async () => {
    const { student, project } = await scene();
    const out = await suggestHelpers(student.id, {
      projectId: project.id,
      taskId: null,
      reason: "tech",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].degraded).toBe(true);
  });

  it("同里程碑下做成过活的人被优先推荐", async () => {
    const { owner, student, mate, project } = await scene();
    const m = await createTask(owner.id, project.id, { title: "占位" });
    void m;
    // mate 在同一项目完成过两项，student 没完成过
    const t1 = await createTask(owner.id, project.id, { title: "甲", assigneeId: mate.id });
    const t2 = await createTask(owner.id, project.id, { title: "乙", assigneeId: mate.id });
    await updateTask(owner.id, t1.id, { status: "done" });
    await updateTask(owner.id, t2.id, { status: "done" });

    const out = await suggestHelpers(student.id, {
      projectId: project.id,
      taskId: null,
      reason: "tech",
    });
    expect(out[0].userId).toBe(mate.id);
  });

  it("非成员得空数组而非报错", async () => {
    const { outsider, project } = await scene();
    const out = await suggestHelpers(outsider.id, {
      projectId: project.id,
      taskId: null,
      reason: "tech",
    });
    expect(out).toEqual([]);
  });
});
