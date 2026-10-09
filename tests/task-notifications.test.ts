import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskStages } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject, updateProject } from "@/lib/project";
import { createTask, reviewTask, setTaskSuccessors, submitTask, updateTask } from "@/lib/task";
import { dismissTaskNotification, enqueueStageHandoffs, listTaskNotifications } from "@/lib/task-notifications";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ email: "owner@example.com", password: "password123", name: "组长" });
  const member = await createUser({ email: "member@example.com", password: "password123", name: "接棒人" });
  const team = await createTeam(owner.id, "交接测试");
  await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "测试项目" });
  const before = await createTask(owner.id, project.id, { title: "完成设计", assigneeId: owner.id });
  const after = await createTask(owner.id, project.id, { title: "开发页面", assigneeId: member.id });
  await db.update(tasks).set({ sortOrder: 1 }).where(eq(tasks.id, before.id));
  await db.update(tasks).set({ sortOrder: 2 }).where(eq(tasks.id, after.id));
  return { owner, member, team, project, before, after };
}

describe("站内交接通知", () => {
  beforeEach(resetDb);

  it("提交不通知下一位，验收通过后按顺位通知；关闭后重读不出现", async () => {
    const { owner, member, before, after } = await scene();
    await submitTask(owner.id, before.id, { completionNote: "设计已交付" });
    expect(await listTaskNotifications(member.id)).toEqual([]);
    await reviewTask(owner.id, before.id, { decision: "accept" });
    const notices = await listTaskNotifications(member.id);
    expect(notices).toHaveLength(1);
    expect(notices[0].taskId).toBe(after.id);
    expect(await listTaskNotifications(owner.id)).toEqual([]);
    await expect(dismissTaskNotification(owner.id, notices[0].id)).rejects.toThrow("没有权限");
    await dismissTaskNotification(member.id, notices[0].id);
    expect(await listTaskNotifications(member.id)).toEqual([]);
    await expect(reviewTask(owner.id, before.id, { decision: "accept" })).rejects.toThrow("待验收");
  });

  it("退回不发通知", async () => {
    const { owner, member, before } = await scene();
    await submitTask(owner.id, before.id, { completionNote: "初稿" });
    await reviewTask(owner.id, before.id, { decision: "reject", note: "补齐页面" });
    expect(await listTaskNotifications(member.id)).toEqual([]);
  });

  it("原有管理员完成入口同样通知；重开再完成允许新一轮提醒", async () => {
    const { owner, member, before } = await scene();
    await updateTask(owner.id, before.id, { status: "done" });
    const [first] = await listTaskNotifications(member.id);
    expect(first).toBeDefined();
    await dismissTaskNotification(member.id, first.id);
    await updateTask(owner.id, before.id, { status: "done" });
    expect(await listTaskNotifications(member.id)).toEqual([]);
    await updateTask(owner.id, before.id, { status: "doing" });
    await updateTask(owner.id, before.id, { status: "done" });
    expect(await listTaskNotifications(member.id)).toHaveLength(1);
  });

  it("依赖优先；两个前置同时验收，也只在全部完成后通知一次", async () => {
    const { owner, member, project, before, after } = await scene();
    const second = await createTask(owner.id, project.id, { title: "准备接口", assigneeId: owner.id });
    await setTaskSuccessors(owner.id, before.id, [after.id]);
    await setTaskSuccessors(owner.id, second.id, [after.id]);
    await submitTask(owner.id, before.id, { completionNote: "完成" });
    await submitTask(owner.id, second.id, { completionNote: "完成" });
    await Promise.all([reviewTask(owner.id, before.id, { decision: "accept" }), reviewTask(owner.id, second.id, { decision: "accept" })]);
    expect(await listTaskNotifications(member.id)).toHaveLength(1);
  });

  it("并发重复验收只有一次成功和一条通知", async () => {
    const { owner, member, before } = await scene();
    await submitTask(owner.id, before.id, { completionNote: "完成" });
    const results = await Promise.allSettled([reviewTask(owner.id, before.id, { decision: "accept" }), reviewTask(owner.id, before.id, { decision: "accept" })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await listTaskNotifications(member.id)).toHaveLength(1);
  });

  it("改派和归档后隐藏旧通知", async () => {
    const { owner, member, before, after, project } = await scene();
    await submitTask(owner.id, before.id, { completionNote: "完成" });
    await reviewTask(owner.id, before.id, { decision: "accept" });
    await updateTask(owner.id, after.id, { assigneeId: owner.id });
    expect(await listTaskNotifications(member.id)).toEqual([]);
    await updateTask(owner.id, after.id, { assigneeId: member.id });
    await updateProject(owner.id, project.id, { status: "archived" });
    expect(await listTaskNotifications(member.id)).toEqual([]);
  });

  it("锁定阶段不会提前提醒；解锁后通知该阶段负责人", async () => {
    const { owner, member, project, before, after } = await scene();
    const [first, next] = await db.insert(taskStages).values([
      { projectId: project.id, title: "设计", position: 0, status: "active" },
      { projectId: project.id, title: "开发", position: 1, status: "locked" },
    ]).returning();
    await db.update(tasks).set({ stageId: first.id }).where(eq(tasks.id, before.id));
    await db.update(tasks).set({ stageId: next.id }).where(eq(tasks.id, after.id));
    await setTaskSuccessors(owner.id, before.id, [after.id]);
    await submitTask(owner.id, before.id, { completionNote: "完成" });
    await reviewTask(owner.id, before.id, { decision: "accept" });
    expect(await listTaskNotifications(member.id)).toEqual([]);
    await db.transaction(async tx => {
      await tx.update(taskStages).set({ status: "active" }).where(eq(taskStages.id, next.id));
      await enqueueStageHandoffs(tx, next.id, first.id);
    });
    expect(await listTaskNotifications(member.id)).toHaveLength(1);
  });
});
