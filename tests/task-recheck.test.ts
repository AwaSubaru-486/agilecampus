import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { recheckCompletedTask } from "@/lib/task-recheck";
import { listConsoleTasks } from "@/lib/collaboration-console";
import { resetDb } from "./helpers";
async function scene() {
  const owner = await createUser({ email: "recheck-owner@test.local", password: "password123", name: "组长" });
  const teacher = await createUser({ email: "recheck-teacher@test.local", password: "password123", name: "老师" });
  const member = await createUser({ email: "recheck-member@test.local", password: "password123", name: "组员" });
  const team = await createTeam(owner.id, "复核测试");
  await joinTeam(teacher.id, team.inviteCode); await joinTeam(member.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "复核项目" });
  const [done, pending, own] = await db.insert(tasks).values([
    { projectId: project.id, title: "已完成", assigneeId: member.id, status: "done" },
    { projectId: project.id, title: "待验收", assigneeId: member.id, status: "review" },
    { projectId: project.id, title: "老师本人", assigneeId: teacher.id, status: "done" },
  ]).returning();
  return { owner, teacher, member, team, project, done, pending, own };
}
describe("老师完成成果复核", () => {
  beforeEach(resetDb);
  it("只有已完成任务进入复核队列，保持分页过滤", async () => {
    const { teacher, project, done, own } = await scene();
    const first = await listConsoleTasks(teacher.id, project.id, { scope: "completed", limit: 1 });
    expect(first.items).toHaveLength(1); expect(first.hasMore).toBe(true);
    const next = await listConsoleTasks(teacher.id, project.id, { scope: "completed", cursor: first.nextCursor!, limit: 1 });
    expect([...first.items, ...next.items].map(item => item.id).sort()).toEqual([done.id, own.id].sort());
    await expect(listConsoleTasks(teacher.id, project.id, { scope: "review", cursor: first.nextCursor! })).rejects.toThrow();
  });
  it("复核写入反馈和事件，不重复计入完成贡献或触发交接", async () => {
    const { teacher, project, done } = await scene();
    const updated = await recheckCompletedTask(teacher.id, project.id, done.id, { decision: "accept", note: "证据完整" });
    expect(updated.status).toBe("done"); expect(updated.reviewNote).toContain("证据完整");
    const events = await db.select().from(activityEvents).where(and(eq(activityEvents.taskId, done.id), eq(activityEvents.projectId, project.id)));
    expect(events.map(event => event.type)).toEqual(["task_updated"]);
    const revised = await recheckCompletedTask(teacher.id, project.id, done.id, { decision: "revise", note: "补充演示" });
    expect(revised.status).toBe("done"); expect(revised.reviewNote).toContain("需修改");
  });
  it("拒绝越权、自审、未完成任务、跨项目任务及空修改意见", async () => {
    const { owner, teacher, member, team, project, done, pending, own } = await scene();
    for (const actor of [owner, member]) await expect(recheckCompletedTask(actor.id, project.id, done.id, { decision: "accept" })).rejects.toThrow("只有老师");
    await expect(recheckCompletedTask(teacher.id, project.id, pending.id, { decision: "accept" })).rejects.toThrow("已完成");
    await expect(recheckCompletedTask(teacher.id, project.id, own.id, { decision: "accept" })).rejects.toThrow("自己");
    await expect(recheckCompletedTask(teacher.id, project.id, done.id, { decision: "revise", note: " " })).rejects.toThrow("请填写");
    const other = await createProject(owner.id, team.id, { name: "其他项目" });
    await expect(recheckCompletedTask(teacher.id, other.id, done.id, { decision: "accept" })).rejects.toThrow("本项目");
  });
});
