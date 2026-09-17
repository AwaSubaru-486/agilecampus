import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, claimTask, submitTask, reviewTask, listProjectTasks } from "@/lib/task";
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
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const other = await makeUser("other@example.com");
  await joinTeam(other.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, other, outsider, project };
}

describe("claimTask —— 认领与承诺", () => {
  beforeEach(resetDb);

  it("认领写入承诺、预估工时与时刻，并自动进入进行中", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "撰写调研问卷" });

    const claimed = await claimTask(student.id, t.id, {
      commitmentNote: "先出提纲，再发 50 份问卷",
      estimatedHours: 6,
    });
    expect(claimed.assigneeId).toBe(student.id);
    expect(claimed.commitmentNote).toBe("先出提纲，再发 50 份问卷");
    expect(claimed.estimatedHours).toBe(6);
    expect(claimed.committedAt).not.toBeNull();
    expect(claimed.status).toBe("doing");
  });

  it("已被他人认领的任务认不动", async () => {
    const { student, other, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲", assigneeId: student.id });
    await expect(
      claimTask(other.id, t.id, { commitmentNote: "我来做" }),
    ).rejects.toThrow("已有负责人");
  });

  it("自己已认领的可补充承诺", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲", assigneeId: student.id });
    const again = await claimTask(student.id, t.id, { commitmentNote: "改个说法" });
    expect(again.commitmentNote).toBe("改个说法");
  });

  it("非团队成员认不动", async () => {
    const { student, outsider, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await expect(
      claimTask(outsider.id, t.id, { commitmentNote: "插一脚" }),
    ).rejects.toThrow("没有权限");
  });

  it("认领记一笔 task_claimed 事件，摘要有承诺", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await claimTask(student.id, t.id, { commitmentNote: "先出提纲" });

    const feed = await listProjectActivity(student.id, project.id);
    const claimed = feed.find((e) => e.type === "task_claimed");
    expect(claimed?.summary).toContain("先出提纲");
  });
});

describe("submitTask —— 提交成果", () => {
  beforeEach(resetDb);

  it("负责人提交后落入待验收，写入交付说明与时刻", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲", assigneeId: student.id });

    const u = await submitTask(student.id, t.id, { completionNote: "收满 63 份，附原始数据" });
    expect(u.status).toBe("review");
    expect(u.completionNote).toBe("收满 63 份，附原始数据");
    expect(u.submittedAt).not.toBeNull();
  });

  it("非负责人提交不了", async () => {
    const { student, other, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲", assigneeId: student.id });
    await expect(
      submitTask(other.id, t.id, { completionNote: "我来交" }),
    ).rejects.toThrow("只有任务负责人本人");
  });

  it("非负责人提交不了（教师亦然）", async () => {
    const { owner, teacher, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await expect(
      submitTask(teacher.id, t.id, { completionNote: "我替他交" }),
    ).rejects.toThrow("只有任务负责人本人");
  });

  // 教师若恰好也是这份任务的负责人，交活没问题——但验收得由别人来判
  it("教师可交自己认领的活", async () => {
    const { owner, teacher, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: teacher.id });
    const u = await submitTask(teacher.id, t.id, { completionNote: "我做完了" });
    expect(u.status).toBe("review");
  });

  it("交付说明不可为空", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲", assigneeId: student.id });
    await expect(submitTask(student.id, t.id, { completionNote: "   " })).rejects.toThrow(
      "请说明这次交付了什么",
    );
  });

  it("已在待验收的不可重复提交", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲", assigneeId: student.id });
    await submitTask(student.id, t.id, { completionNote: "交了" });
    await expect(submitTask(student.id, t.id, { completionNote: "再交" })).rejects.toThrow(
      "已在待验收中",
    );
  });

  it("组长可代提交（admin 代操作）", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    const u = await submitTask(owner.id, t.id, { completionNote: "他线下交给我了" });
    expect(u.status).toBe("review");
  });
});

describe("reviewTask —— 验收", () => {
  async function pending() {
    const s = await scene();
    const t = await createTask(s.owner.id, s.project.id, {
      title: "撰写调研问卷",
      assigneeId: s.student.id,
    });
    await submitTask(s.student.id, t.id, { completionNote: "交卷" });
    return { ...s, t };
  }

  beforeEach(resetDb);

  it("组长通过 → 已完成，记下验收人与时刻", async () => {
    const { owner, t } = await pending();
    const u = await reviewTask(owner.id, t.id, { decision: "accept" });
    expect(u.status).toBe("done");
    expect(u.reviewedById).toBe(owner.id);
    expect(u.reviewedAt).not.toBeNull();
  });

  // teacher 在本项目里唯一的写入能力，正是开题报告那句「组长或教师进行验收或退回」
  it("教师可通过", async () => {
    const { teacher, t } = await pending();
    const u = await reviewTask(teacher.id, t.id, { decision: "accept" });
    expect(u.status).toBe("done");
  });

  it("学生验收不了", async () => {
    const { other, t } = await pending();
    await expect(reviewTask(other.id, t.id, { decision: "accept" })).rejects.toThrow(
      "只有组长或教师可以验收",
    );
  });

  // 教师既干活又当验收时，不能自己给自己盖章——否则「验收」二字形同虚设
  it("不能验收自己交付的任务", async () => {
    const { owner, teacher, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: teacher.id });
    await submitTask(teacher.id, t.id, { completionNote: "我做完了" });
    await expect(reviewTask(teacher.id, t.id, { decision: "accept" })).rejects.toThrow(
      "不能验收自己交付的任务",
    );
    // 换别人来判就通得过
    const u = await reviewTask(owner.id, t.id, { decision: "accept" });
    expect(u.status).toBe("done");
  });

  it("退回 → 回到进行中，返工计数加一，留验收意见", async () => {
    const { owner, t } = await pending();
    const u = await reviewTask(owner.id, t.id, { decision: "reject", note: "样本量不够，补到 100 份" });
    expect(u.status).toBe("doing");
    expect(u.rejectCount).toBe(1);
    expect(u.reviewNote).toBe("样本量不够，补到 100 份");
  });

  // 没写理由的退回，成员只知道被否了，不知道改什么
  it("退回必须写明要改什么", async () => {
    const { owner, t } = await pending();
    await expect(reviewTask(owner.id, t.id, { decision: "reject" })).rejects.toThrow(
      "请写明需要改什么",
    );
  });

  it("不在待验收状态的任务验收不了", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await expect(reviewTask(owner.id, t.id, { decision: "accept" })).rejects.toThrow(
      "不在待验收状态",
    );
  });

  it("非团队成员验收不了", async () => {
    const { outsider, t } = await pending();
    await expect(reviewTask(outsider.id, t.id, { decision: "accept" })).rejects.toThrow(
      "没有权限",
    );
  });
});

describe("承诺到验收的完整闭环", () => {
  beforeEach(resetDb);

  it("认领→提交→退回→再提交→通过，事件链完整且返工计一次", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "撰写调研问卷" });

    await claimTask(student.id, t.id, { commitmentNote: "先出提纲再发问卷", estimatedHours: 6 });
    await submitTask(student.id, t.id, { completionNote: "第一版" });
    await reviewTask(owner.id, t.id, { decision: "reject", note: "提纲太粗" });
    await submitTask(student.id, t.id, { completionNote: "第二版，提纲重写了" });
    const final = await reviewTask(owner.id, t.id, { decision: "accept" });

    expect(final.status).toBe("done");
    expect(final.rejectCount).toBe(1);

    const types = (await listProjectActivity(student.id, project.id)).map((e) => e.type);
    expect(types).toContain("task_claimed");
    expect(types).toContain("task_submitted");
    expect(types).toContain("task_rejected");
    expect(types).toContain("task_accepted");
    // 提交过两次
    expect(types.filter((x) => x === "task_submitted")).toHaveLength(2);
  });

  it("承诺内容在任务列表里可取，供卡面常驻展示", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await claimTask(student.id, t.id, { commitmentNote: "先出提纲", estimatedHours: 3 });

    const [row] = await listProjectTasks(student.id, project.id);
    expect(row.commitmentNote).toBe("先出提纲");
    expect(row.estimatedHours).toBe(3);
    expect(row.createdById).not.toBeNull();
  });
});
