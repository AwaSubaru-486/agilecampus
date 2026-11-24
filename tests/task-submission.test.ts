import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, evidenceItems, taskDeliveries, taskStages, tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, getTaskDetail, reviewTask, updateTask } from "@/lib/task";
import { submitTaskWithDelivery } from "@/lib/task-submission";
import { recheckCompletedTask } from "@/lib/task-recheck";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ email: "submit-owner@test.local", name: "组长", password: "password123" });
  const member = await createUser({ email: "submit-member@test.local", name: "组员", password: "password123" });
  const teacher = await createUser({ email: "submit-teacher@test.local", name: "老师", password: "password123" });
  const team = await createTeam(owner.id, "直接交付");
  await joinTeam(member.id, team.inviteCode); await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "审核流程" });
  const task = await createTask(owner.id, project.id, { title: "无需接住", assigneeId: member.id, requiredEvidence: ["text", "test"] });
  return { owner, member, teacher, project, task };
}
const input = { branchName: "task/feature", headSha: "abc123", pullRequestUrl: "https://github.com/example/repo/pull/1", testSummary: "关键流程通过", completionNote: "交付成果", handoffVersion: 1, evidence: { text: "成果文档", test: "测试通过" } };
async function receipts(id: string) { return db.select().from(taskDeliveries).where(eq(taskDeliveries.taskId, id)); }
describe("直接提交材料，组长审核，老师复核", () => {
  beforeEach(resetDb);
  it("无需认领，待办直接进入审核并保存完整交付材料", async () => {
    const { owner, member, task } = await scene();
    expect(task.committedAt).toBeNull();
    const result = await submitTaskWithDelivery(member.id, task.id, input);
    expect(result.status).toBe("review"); expect(result.assigneeId).toBe(member.id); expect(result.committedAt).toBeNull();
    expect(await receipts(task.id)).toMatchObject([{ branchName: input.branchName, headSha: input.headSha, pullRequestUrl: input.pullRequestUrl, testSummary: input.testSummary, submittedById: member.id }]);
    expect((await getTaskDetail(owner.id, task.id)).status).toBe("review");
  });
  it("材料不全或 URL 无效时不留下分支、证据或提交活动", async () => {
    const { owner, member, task } = await scene();
    for (const invalid of [{ ...input, evidence: { text: "只写了一项" } }, { ...input, branchName: " " }, { ...input, pullRequestUrl: "javascript:alert(1)" }]) {
      await expect(submitTaskWithDelivery(member.id, task.id, invalid)).rejects.toThrow();
      expect(await receipts(task.id)).toHaveLength(0);
      expect(await db.select().from(evidenceItems).where(eq(evidenceItems.taskId, task.id))).toHaveLength(0);
      expect((await getTaskDetail(owner.id, task.id)).status).toBe("todo");
      expect(await db.select().from(activityEvents).where(and(eq(activityEvents.taskId, task.id), eq(activityEvents.type, "task_submitted")))).toHaveLength(0);
    }
  });
  it("旧窗口版本和重复提交不重复登记材料", async () => {
    const { owner, member, task } = await scene();
    await updateTask(owner.id, task.id, { handoffBrief: "新版要求" });
    await expect(submitTaskWithDelivery(member.id, task.id, input)).rejects.toThrow("重新打开提交窗口");
    expect(await receipts(task.id)).toHaveLength(0);
    await submitTaskWithDelivery(member.id, task.id, { ...input, handoffVersion: 2 });
    await expect(submitTaskWithDelivery(member.id, task.id, { ...input, handoffVersion: 2 })).rejects.toThrow("待验收");
    expect(await receipts(task.id)).toHaveLength(1);
  });
  it("只有组长初审，通过后老师才可以复核", async () => {
    const { owner, member, teacher, project, task } = await scene();
    await submitTaskWithDelivery(member.id, task.id, input);
    await expect(reviewTask(teacher.id, task.id, { decision: "accept" })).rejects.toThrow("任务由组长审核");
    await expect(reviewTask(member.id, task.id, { decision: "accept" })).rejects.toThrow("任务由组长审核");
    await expect(recheckCompletedTask(teacher.id, project.id, task.id, { decision: "accept" })).rejects.toThrow("已完成");
    await reviewTask(owner.id, task.id, { decision: "accept", note: "组长通过" });
    const reviewed = await recheckCompletedTask(teacher.id, project.id, task.id, { decision: "accept", note: "老师复核" });
    expect(reviewed.status).toBe("done"); expect(reviewed.reviewedById).toBe(teacher.id);
  });
  it("退回可重新填写材料提交，锁定阶段和非负责人不能交任务", async () => {
    const { owner, member, teacher, project, task } = await scene();
    await expect(submitTaskWithDelivery(teacher.id, task.id, input)).rejects.toThrow();
    await submitTaskWithDelivery(member.id, task.id, input);
    await reviewTask(owner.id, task.id, { decision: "reject", note: "补充测试" });
    await submitTaskWithDelivery(member.id, task.id, { ...input, branchName: "task/revision" });
    expect(await receipts(task.id)).toHaveLength(2);
    const [stage] = await db.insert(taskStages).values({ projectId: project.id, title: "未开放", position: 2, status: "locked" }).returning();
    const [locked] = await db.insert(tasks).values({ projectId: project.id, title: "锁定任务", assigneeId: member.id, stageId: stage.id }).returning();
    await expect(submitTaskWithDelivery(member.id, locked.id, input)).rejects.toThrow("当前阶段");
    expect(await receipts(locked.id)).toHaveLength(0);
  });
});
