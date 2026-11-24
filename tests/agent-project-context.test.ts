import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskStages, tasks, taskDeliveries, blockers, stageIntegrations } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createEvidenceItem } from "@/lib/evidence";
import { queryStageProgress, queryTeamWorkload, queryProjectHelp, getTaskContext } from "@/lib/agent/project-context";
import { queryProgress, listTasksFiltered } from "@/lib/agent/tools";
import { buildProjectSnapshot } from "@/lib/agent/snapshot";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ name: "组长", email: "owner@context.test", password: "password123" });
  const member = await createUser({ name: "鱼乐", email: "member@context.test", password: "password123" });
  const teacher = await createUser({ name: "郭诗辉", email: "teacher@context.test", password: "password123" });
  const team = await createTeam(owner.id, "汪汪队");
  await joinTeam(member.id, team.inviteCode); await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "敏捷开发平台" });
  const [first, next] = await db.insert(taskStages).values([
    { projectId: project.id, title: "需求与范围", position: 0, status: "active" },
    { projectId: project.id, title: "实现", position: 1, status: "locked" },
  ]).returning();
  const [done, todo, future] = await db.insert(tasks).values([
    { projectId: project.id, title: "定义范围", stageId: first.id, assigneeId: member.id, status: "done" },
    { projectId: project.id, title: "确认标准", stageId: first.id, assigneeId: member.id, requiredEvidence: ["test", "link"], doneCriteria: ["有可检查标准"], dueDate: "2000-01-01" },
    { projectId: project.id, title: "实现功能", stageId: next.id, assigneeId: member.id },
    { projectId: project.id, title: "需求分组", stageId: first.id, isTaskGroup: true, status: "done" },
  ]).returning();
  await db.insert(taskDeliveries).values({ taskId: done.id, branchName: "feature/scope" });
  await db.insert(blockers).values({ projectId: project.id, taskId: todo.id, raisedById: member.id, reason: "unclear", helpNeeded: "需要确认验收标准" });
  return { owner, member, teacher, team, project, first, next, done, todo, future };
}

describe("AI 实际项目查询", () => {
  beforeEach(resetDb);
  it("当前阶段分母只包含该阶段叶子任务，分别报告验收与集成缺口", async () => {
    const s = await scene();
    await db.insert(stageIntegrations).values({ stageId: s.first.id, branchName: "integration/first", decision: "rejected", reviewNote: "缺测试" });
    const progress = await queryStageProgress(s.member.id, s.project.id);
    expect(progress.currentStage).toMatchObject({ id: s.first.id, taskTotal: 2, acceptedTasks: 1, remainingAcceptance: 1, missingDeliveryBranches: 1, integration: { decision: "rejected" } });
    expect(progress.stages[1]).toMatchObject({ status: "locked", taskTotal: 1 });
    expect((await queryProgress(s.member.id, s.project.id)).taskTotal).toBe(3);
    const snapshot = await buildProjectSnapshot(s.member.id, s.project.id);
    expect(snapshot).toContain("当前阶段验收 1/2"); expect(snapshot).toContain(s.member.id);
  });
  it("成员任务量排除分组，并显示未接住、逾期、求助和老师职责", async () => {
    const s = await scene();
    const workload = await queryTeamWorkload(s.owner.id, s.project.id);
    expect(workload.members.find(member => member.id === s.member.id)).toMatchObject({ taskTotal: 3, unfinished: 2, awaitingCommitment: 2, overdue: 1, openHelpRequests: 1 });
    expect(workload.members.find(member => member.id === s.teacher.id)).toMatchObject({ canExecute: false, taskTotal: 0 });
    expect((await queryProjectHelp(s.member.id, s.project.id))[0]).toMatchObject({ raisedByName: "鱼乐", helpNeeded: "需要确认验收标准", taskId: s.todo.id });
  });
  it("任务上下文能区分已有与缺失证据，按阶段和关键词查找实际任务", async () => {
    const s = await scene();
    await createEvidenceItem(s.member.id, s.todo.id, { type: "link", label: "成果", value: "https://example.com/result" });
    const context = await getTaskContext(s.member.id, s.project.id, s.todo.id);
    expect(context.stage?.id).toBe(s.first.id);
    expect(context.missingEvidence).toEqual(["test"]);
    expect(context.evidence[0]).toMatchObject({ label: "成果", value: "https://example.com/result" });
    const filtered = await listTasksFiltered(s.member.id, s.project.id, { stageId: s.first.id, query: "标准" });
    expect(filtered.map(task => task.id)).toEqual([s.todo.id]);
    const other = await createProject(s.owner.id, s.team.id, { name: "其他项目" });
    await expect(getTaskContext(s.owner.id, other.id, s.todo.id)).rejects.toThrow("当前项目");
  });
  it("所有新增查询都检查成员权限，查询不会修改任务", async () => {
    const s = await scene();
    const outsider = await createUser({ name: "外部", email: "outside@context.test", password: "password123" });
    for (const query of [queryStageProgress, queryTeamWorkload, queryProjectHelp]) await expect(query(outsider.id, s.project.id)).rejects.toThrow("没有权限");
    await expect(getTaskContext(outsider.id, s.project.id, s.todo.id)).rejects.toThrow("没有权限");
    const before = await db.select().from(tasks).where(eq(tasks.projectId, s.project.id));
    await Promise.all([queryStageProgress(s.member.id, s.project.id), queryTeamWorkload(s.member.id, s.project.id), getTaskContext(s.member.id, s.project.id, s.todo.id)]);
    expect(await db.select().from(tasks).where(eq(tasks.projectId, s.project.id))).toEqual(before);
  });
});
