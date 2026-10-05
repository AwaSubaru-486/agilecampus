import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { claimTask, createTask, reviewTask, submitTask } from "@/lib/task";
import { raiseBlocker, resolveBlocker } from "@/lib/blocker";
import { buildContributionReport, NOT_MEASURABLE } from "@/lib/contribution";
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
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, mate, teacher, project };
}

const rowOf = (report: Awaited<ReturnType<typeof buildContributionReport>>, id: string) =>
  report.rows.find((r) => r.userId === id)!;

describe("贡献记录 —— 全自动，无人填写", () => {
  beforeEach(resetDb);

  it("新项目里各人都是零，不报错", async () => {
    const { owner, project } = await scene();
    const report = await buildContributionReport(owner.id, project.id);
    expect(report.rows.length).toBeGreaterThan(0);
    expect(rowOf(report, owner.id).acceptedCount).toBe(0);
    expect(report.reviewStats.rejectRate).toBeNull();
  });

  // 头条数字取「被验收通过」而非「创建了多少」——后者可以灌水
  it("交付数只认被验收通过的", async () => {
    const { owner, student, project } = await scene();
    const t1 = await createTask(owner.id, project.id, { title: "甲" });
    await claimTask(student.id, t1.id, { commitmentNote: "先出提纲", estimatedHours: 4 });
    await submitTask(student.id, t1.id, { completionNote: "交了" });
    await reviewTask(owner.id, t1.id, { decision: "accept" });

    const t2 = await createTask(owner.id, project.id, { title: "乙" });
    await claimTask(student.id, t2.id, { commitmentNote: "再跑一轮" });
    await submitTask(student.id, t2.id, { completionNote: "交了" });
    // 第二项还没验收

    const report = await buildContributionReport(owner.id, project.id);
    const s = rowOf(report, student.id);
    expect(s.acceptedCount).toBe(1);
    expect(s.submittedCount).toBe(2);
    expect(s.claimedCount).toBe(2);
    expect(s.estimatedHours).toBe(4);
  });

  // 任务事后可能改派，故交付人冻在事件里，不回头查任务行
  it("改派之后，已完成的仍归当时交付的人", async () => {
    const { owner, student, mate, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await claimTask(student.id, t.id, { commitmentNote: "我来" });
    await submitTask(student.id, t.id, { completionNote: "交了" });
    await reviewTask(owner.id, t.id, { decision: "accept" });

    // 事后再改派给另一个人
    const { updateTask } = await import("@/lib/task");
    await updateTask(owner.id, t.id, { assigneeId: mate.id });

    const report = await buildContributionReport(owner.id, project.id);
    expect(rowOf(report, student.id).acceptedCount).toBe(1);
    expect(rowOf(report, mate.id).acceptedCount).toBe(0);
  });

  it("返工与验收参与各自计数", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await claimTask(student.id, t.id, { commitmentNote: "我来" });
    await submitTask(student.id, t.id, { completionNote: "第一版" });
    await reviewTask(owner.id, t.id, { decision: "reject", note: "太粗" });
    await submitTask(student.id, t.id, { completionNote: "第二版" });
    await reviewTask(owner.id, t.id, { decision: "accept" });

    const report = await buildContributionReport(owner.id, project.id);
    expect(rowOf(report, student.id).rejectedCount).toBe(1);
    expect(rowOf(report, student.id).acceptedCount).toBe(1);
    // 组长验收了两次（一次退回、一次通过）
    expect(rowOf(report, owner.id).reviewedCount).toBe(2);
    expect(report.reviewStats).toMatchObject({ accepted: 1, rejected: 1, rejectRate: 50 });
  });

  it("教师验收也计入其参与", async () => {
    const { owner, student, teacher, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await submitTask(student.id, t.id, { completionNote: "交了" });
    await reviewTask(teacher.id, t.id, { decision: "accept" });

    const report = await buildContributionReport(owner.id, project.id);
    expect(rowOf(report, teacher.id).reviewedCount).toBe(1);
  });
});

describe("贡献记录 —— 互助", () => {
  beforeEach(resetDb);

  // 「被邀请」与「真的帮上忙」是两回事，只有后者算贡献
  it("只认解决了别人的求助，被邀请不算", async () => {
    const { owner, student, mate, project } = await scene();
    const { blocker } = await raiseBlocker(student.id, project.id, {
      reason: "tech",
      inviteeIds: [mate.id],
    });

    let report = await buildContributionReport(owner.id, project.id);
    expect(rowOf(report, mate.id).invitedCount).toBe(1);
    expect(rowOf(report, mate.id).helpedOthersCount).toBe(0);

    await resolveBlocker(mate.id, blocker.id, { note: "给了脚本" });
    report = await buildContributionReport(owner.id, project.id);
    expect(rowOf(report, mate.id).helpedOthersCount).toBe(1);
  });

  it("自己解决自己的求助不算互助", async () => {
    const { owner, student, project } = await scene();
    const { blocker } = await raiseBlocker(student.id, project.id, { reason: "time" });
    await resolveBlocker(student.id, blocker.id);

    const report = await buildContributionReport(owner.id, project.id);
    expect(rowOf(report, student.id).helpedOthersCount).toBe(0);
  });

  it("阻塞统计按原因归并，并给出平均解决时长", async () => {
    const { owner, student, mate, project } = await scene();
    const a = await raiseBlocker(student.id, project.id, { reason: "tech" });
    await raiseBlocker(student.id, project.id, { reason: "tech" });
    await raiseBlocker(student.id, project.id, { reason: "time" });
    await resolveBlocker(mate.id, a.blocker.id, { note: "搞定" });

    const report = await buildContributionReport(owner.id, project.id);
    expect(report.blockerStats.total).toBe(3);
    expect(report.blockerStats.resolved).toBe(1);
    expect(report.blockerStats.open).toBe(2);
    expect(report.blockerStats.byReason[0]).toMatchObject({ reason: "tech", count: 2 });
    // 刚解决，耗时不足一小时，四舍五入为 0
    expect(report.blockerStats.avgResolveHours).toBe(0);
  });
});

describe("贡献记录 —— 必须说明算不出来的部分", () => {
  beforeEach(resetDb);

  it("诚实清单不为空，且覆盖几个关键维度", () => {
    const joined = NOT_MEASURABLE.join("｜");
    expect(NOT_MEASURABLE.length).toBeGreaterThanOrEqual(5);
    expect(joined).toContain("实际投入时长");
    expect(joined).toContain("线下贡献");
    expect(joined).toContain("任务难度");
  });

  // 本项目刻意不做贡献总分。这条断言把「不做」钉住——
  // 若日后有人加了 score 字段，这里会提醒他先读上面那段理由
  it("不产出任何单一分数", async () => {
    const { owner, project } = await scene();
    const report = await buildContributionReport(owner.id, project.id);
    const keys = Object.keys(report.rows[0] ?? {});
    expect(keys).not.toContain("score");
    expect(keys).not.toContain("total");
    expect(keys).not.toContain("rating");
  });
});

describe("贡献记录 —— 权限", () => {
  beforeEach(resetDb);

  it("非成员读不到", async () => {
    const { project } = await scene();
    const outsider = await makeUser("outsider@example.com");
    await expect(buildContributionReport(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});
