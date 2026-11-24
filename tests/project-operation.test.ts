import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
const cookie = vi.hoisted(() => ({ value: undefined as string | undefined, auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => cookie.value ? { value: cookie.value } : undefined }) }));
vi.mock("@/lib/auth", () => ({ auth: cookie.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { db } from "@/db";
import { activityEvents, stageIntegrations, taskStages, teamMembers, tasks } from "@/db/schema";
import { claimTaskAction, submitTaskAction, reviewTaskAction, recheckCompletedTaskAction } from "@/app/(app)/projects/[projectId]/actions";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, claimTask, submitTask, reviewTask, getTaskDetail } from "@/lib/task";
import { reviewStageIntegration, submitTaskDelivery } from "@/lib/task-tree";
import { createProjectMemory } from "@/lib/project-memory";
import { runProjectOperation } from "@/lib/project-operation";
import { projectOperationContext } from "@/lib/project-operation-context";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ email: "operator@test.local", name: "组长", password: "password123" });
  const member = await createUser({ email: "member@test.local", name: "鱼乐", password: "password123" });
  const other = await createUser({ email: "other@test.local", name: "哈哈哈", password: "password123" });
  const teacher = await createUser({ email: "teacher@test.local", name: "郭诗辉", password: "password123" });
  const team = await createTeam(owner.id, "代操作测试");
  for (const person of [member, other, teacher]) await joinTeam(person.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "实际项目" });
  const task = await createTask(owner.id, project.id, { title: "需要交付", assigneeId: member.id });
  cookie.auth.mockResolvedValue({ user: { id: owner.id } });
  return { owner, member, other, teacher, team, project, task };
}

describe("组长切换身份后实际操作", () => {
  beforeEach(async () => { cookie.value = undefined; await resetDb(); });
  it("组员视角认领和提交，保留组员负责人及真实组长审计", async () => {
    const { owner, member, project, task } = await scene();
    cookie.value = `student:${member.id}`;
    const form = new FormData(); form.set("projectId", project.id); form.set("taskId", task.id); form.set("commitmentNote", "按要求完成");
    expect(await claimTaskAction(null, form)).toBeNull();
    const claimed = await getTaskDetail(owner.id, task.id);
    expect(claimed.assigneeId).toBe(member.id); expect(claimed.status).toBe("doing");
    form.set("completionNote", "材料已完成"); form.set("branchName", "task/feature"); form.set("handoffVersion", "1");
    expect(await submitTaskAction(null, form)).toEqual({ ok: true });
    expect((await getTaskDetail(owner.id, task.id)).status).toBe("review");
    const records = await db.select().from(activityEvents).where(and(eq(activityEvents.taskId, task.id), eq(activityEvents.type, "task_claimed")));
    expect(records[0].actorId).toBe(owner.id);
    expect(records[0].summary).toContain("组长代鱼乐操作");
    expect(records[0].payload).toMatchObject({ delegation: { operatorId: owner.id, actingAsId: member.id, role: "student" } });
    expect(projectOperationContext.getStore()).toBeUndefined();
  });
  it("老师视角可复核组长审核后的任务，审核身份与组长操作者均可追溯", async () => {
    const { owner, member, teacher, project, task } = await scene();
    await claimTask(member.id, task.id, { commitmentNote: "完成" });
    await submitTask(member.id, task.id, { completionNote: "完成" });
    cookie.value = `teacher:${teacher.id}`;
    const form = new FormData(); form.set("projectId", project.id); form.set("taskId", task.id); form.set("decision", "accept"); form.set("note", "通过");
    expect(await reviewTaskAction(null, form)).toHaveProperty("error");
    cookie.value = "admin";
    expect(await reviewTaskAction(null, form)).toBeNull();
    const reviewed = await getTaskDetail(owner.id, task.id);
    expect(reviewed.status).toBe("done"); expect(reviewed.reviewedById).toBe(owner.id);
    cookie.value = `teacher:${teacher.id}`;
    form.set("note", "证据完整");
    expect(await recheckCompletedTaskAction(null, form)).toEqual({ ok: true });
    const records = await db.select().from(activityEvents).where(and(eq(activityEvents.taskId, task.id), eq(activityEvents.type, "task_updated")));
    expect(records[0].actorId).toBe(owner.id); expect(records[0].payload).toMatchObject({ delegation: { actingAsId: teacher.id } });
  });
  it("老师视角可以审核组长提交的阶段集成", async () => {
    const { owner, teacher, project } = await scene();
    const [stage] = await db.insert(taskStages).values({ projectId: project.id, title: "审核阶段", position: 1, status: "integrating" }).returning();
    const [integration] = await db.insert(stageIntegrations).values({ stageId: stage.id, branchName: "test/integration", submittedById: owner.id }).returning();
    cookie.value = `teacher:${teacher.id}`;
    await runProjectOperation(owner.id, project.id, "审核阶段集成", id => reviewStageIntegration(id, integration.id, { decision: "accept" }), { kind: "integration", id: integration.id });
    const [updated] = await db.select().from(stageIntegrations).where(eq(stageIntegrations.id, integration.id));
    expect(updated.reviewedById).toBe(teacher.id); expect(updated.decision).toBe("accepted");
  });
  it("组员视角登记任务分支与记忆自动关联所选成员", async () => {
    const { owner, member, project } = await scene();
    const [stage] = await db.insert(taskStages).values({ projectId: project.id, title: "当前阶段", position: 1, status: "active" }).returning();
    const [task] = await db.insert(tasks).values({ projectId: project.id, stageId: stage.id, title: "分支材料", assigneeId: member.id }).returning();
    cookie.value = `student:${member.id}`;
    const delivery = await runProjectOperation(owner.id, project.id, "登记分支", id => submitTaskDelivery(id, task.id, { branchName: "test/feature", testSummary: "测试通过" }), { kind: "task", id: task.id });
    expect(delivery.submittedById).toBe(member.id);
    const memory = await runProjectOperation(owner.id, project.id, "添加记忆", id => createProjectMemory(id, project.id, { taskId: task.id, category: "decision", title: "接口决策", content: "保持兼容" }), { kind: "task", id: task.id });
    expect(memory.creatorId).toBe(member.id);
    const records = await db.select().from(activityEvents).where(eq(activityEvents.taskId, task.id));
    expect(records.every(record => record.actorId === owner.id)).toBe(true);
  });
  it("非组长伪造老师 cookie 无法获得老师权限", async () => {
    const { member, teacher, project, task } = await scene();
    cookie.value = `teacher:${teacher.id}`;
    await expect(runProjectOperation(member.id, project.id, "验收", id => reviewTask(id, task.id, { decision: "accept" }), { kind: "task", id: task.id })).rejects.toThrow("任务由组长审核");
  });
  it("所选组员不能操作别人的任务或执行老师审核", async () => {
    const { owner, other, project, task } = await scene();
    cookie.value = `student:${other.id}`;
    await expect(runProjectOperation(owner.id, project.id, "认领", id => claimTask(id, task.id, { commitmentNote: "接住" }), { kind: "task", id: task.id })).rejects.toThrow("已有负责人");
    await expect(runProjectOperation(owner.id, project.id, "审核", id => reviewTask(id, task.id, { decision: "accept" }), { kind: "task", id: task.id })).rejects.toThrow("任务由组长审核");
  });
  it("移除成员、角色变更和跨项目对象均在执行前拒绝", async () => {
    const { owner, member, teacher, team, project, task } = await scene();
    cookie.value = `student:${member.id}`;
    const otherProject = await createProject(owner.id, team.id, { name: "其他项目" });
    const execute = vi.fn();
    await expect(runProjectOperation(owner.id, otherProject.id, "认领", execute, { kind: "task", id: task.id })).rejects.toThrow("不属于");
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, member.id)));
    await expect(runProjectOperation(owner.id, project.id, "认领", execute, { kind: "task", id: task.id })).rejects.toThrow("重新切换");
    cookie.value = `teacher:${teacher.id}`;
    await updateMemberRole(owner.id, team.id, teacher.id, "student");
    await expect(runProjectOperation(owner.id, project.id, "审核", execute, { kind: "task", id: task.id })).rejects.toThrow("重新切换");
    expect(execute).not.toHaveBeenCalled();
  });
});
