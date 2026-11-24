import { beforeEach, expect, it } from "vitest";
import { db } from "@/db";
import { activityEvents, blockers, evidenceItems, projectEntries, tasks } from "@/db/schema";
import { buildPersonalRetrospective, buildProjectRetrospective, listRetrospectiveProjects } from "@/lib/project-retrospective";
import { createProject } from "@/lib/project";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function fixture() {
  const owner = await createUser({ email: "report-owner@test.local", password: "fixture-password", name: "组长" });
  const member = await createUser({ email: "report-member@test.local", password: "fixture-password", name: "组员" });
  const teacher = await createUser({ email: "report-teacher@test.local", password: "fixture-password", name: "导师" });
  const team = await createTeam(owner.id, "复盘演示团队");
  await joinTeam(member.id, team.inviteCode);
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "本项目" });
  return { owner, member, teacher, team, project };
}

it("根据当前交付、最近验收意见和关联档案汇总对应项目", async () => {
  const { owner, member, teacher, team, project } = await fixture();
  const other = await createProject(owner.id, team.id, { name: "另一个项目" });
  const submittedAt = new Date("2026-11-01T10:00:00Z");
  const reviewedAt = new Date("2026-11-02T10:00:00Z");
  const recheckedAt = new Date("2026-11-03T10:00:00Z");
  const defaults = { projectId: project.id, assigneeId: member.id };
  const [accepted, gap, waiting, returned] = await db.insert(tasks).values([
    { ...defaults, title: "库存查询", status: "done", submittedAt, reviewedAt, completionNote: "可以查询库存" },
    { ...defaults, title: "存取记录", status: "done", submittedAt, reviewedAt },
    { ...defaults, title: "缺货提醒", status: "review", submittedAt },
    { ...defaults, title: "盘点清单", status: "doing", submittedAt, reviewedAt, rejectCount: 1 },
    { ...defaults, title: "手动标记完成", status: "done" },
    { ...defaults, projectId: other.id, title: "他项目交付", status: "done", submittedAt, reviewedAt },
  ]).returning();
  await db.insert(activityEvents).values([
    { projectId: project.id, taskId: accepted.id, actorId: owner.id, type: "task_accepted", createdAt: reviewedAt },
    { projectId: project.id, taskId: accepted.id, actorId: teacher.id, type: "task_updated", createdAt: recheckedAt,
      payload: { recheck: true, decision: "revise", note: "补充低库存用例" } },
    { projectId: project.id, taskId: returned.id, actorId: owner.id, type: "task_rejected", createdAt: reviewedAt,
      payload: { title: returned.title, note: "缺少盘点依据" } },
  ]);
  await db.insert(projectEntries).values([
    { projectId: project.id, taskId: accepted.id, type: "doc", title: "查询验收记录" },
    { projectId: project.id, taskId: gap.id, type: "feedback", title: "建议保留归档" },
    { projectId: other.id, type: "doc", title: "他项目文档" },
  ]);

  const report = await buildProjectRetrospective(owner.id, project.id);
  expect(report.hasRecords).toBe(true);
  expect(report.accepted.map(item => item.title).sort()).toEqual(["存取记录", "库存查询"]);
  expect(report.waiting.map(item => item.id)).toEqual([waiting.id]);
  expect(report.rework).toEqual([{ id: returned.id, title: returned.title, note: "缺少盘点依据" }]);
  expect(report.recheckFollowUp).toEqual([{ id: accepted.id, title: accepted.title, note: "补充低库存用例" }]);
  expect(report.unarchived.map(item => item.id)).toEqual([gap.id]);
  expect(report.completedWithoutReview).toBe(1);
  expect(report.archives).toEqual({ doc: 1, feedback: 1, deliverable: 0 });
});

it("只列出有权限的项目，空项目保留自己的复盘入口", async () => {
  const { owner, member, teacher, project } = await fixture();
  const unrelatedTeam = await createTeam(member.id, "其他团队");
  await createProject(member.id, unrelatedTeam.id, { name: "权限外项目" });

  expect((await listRetrospectiveProjects(owner.id)).map(item => item.id)).toEqual([project.id]);
  expect((await listRetrospectiveProjects(teacher.id)).map(item => item.id)).toEqual([project.id]);
  expect((await listRetrospectiveProjects(member.id)).find(item => item.id === project.id)?.role).toBe("student");
  expect((await buildProjectRetrospective(teacher.id, project.id)).hasRecords).toBe(false);
  await expect(buildProjectRetrospective(member.id, project.id)).rejects.toThrow();
});

it("学生复盘只读取本人的任务、交付材料和对应验收记录", async () => {
  const { owner, member, teacher, project } = await fixture();
  const submittedAt = new Date("2026-11-01T10:00:00Z");
  const reviewedAt = new Date("2026-11-02T10:00:00Z");
  const [own, reassigned, teamTask] = await db.insert(tasks).values([
    { projectId: project.id, title: "我的报名交付", assigneeId: member.id, status: "doing", submittedAt, reviewedAt },
    { projectId: project.id, title: "新接手的任务", assigneeId: member.id, status: "review", submittedAt },
    { projectId: project.id, title: "组长的私有验收样例", assigneeId: owner.id, status: "done", submittedAt, reviewedAt },
  ]).returning();
  await db.insert(activityEvents).values([
    { projectId: project.id, taskId: own.id, actorId: member.id, type: "task_submitted", createdAt: submittedAt,
      payload: { assigneeId: member.id, completionNote: "报名流程已提交" } },
    { projectId: project.id, taskId: own.id, actorId: owner.id, type: "task_rejected", createdAt: reviewedAt,
      payload: { assigneeId: member.id, note: "补充满员提示" } },
    { projectId: project.id, taskId: reassigned.id, actorId: owner.id, type: "task_submitted", createdAt: submittedAt,
      payload: { assigneeId: owner.id, completionNote: "前任的提交说明" } },
    { projectId: project.id, taskId: reassigned.id, actorId: teacher.id, type: "task_rejected", createdAt: reviewedAt,
      payload: { assigneeId: owner.id, note: "前任的验收意见" } },
  ]);
  await db.insert(evidenceItems).values([
    { projectId: project.id, taskId: own.id, submittedById: member.id, type: "text", label: "我的材料", value: "说明" },
    { projectId: project.id, taskId: own.id, submittedById: owner.id, type: "text", label: "别人的材料", value: "说明" },
  ]);
  await db.insert(blockers).values({ projectId: project.id, taskId: own.id, raisedById: member.id, reason: "dependency", helpNeeded: "需要满员样例" });

  const personal = await buildPersonalRetrospective(member.id, project.id);
  expect(personal.assignedCount).toBe(2);
  expect(personal.deliveries).toHaveLength(2);
  expect(personal.deliveries.some(task => task.id === teamTask.id)).toBe(false);
  expect(personal.deliveries).toContainEqual(expect.objectContaining({ id: own.id, returned: true, submitted: "报名流程已提交", feedback: "补充满员提示", evidenceCount: 1 }));
  expect(personal.deliveries).toContainEqual(expect.objectContaining({ id: reassigned.id, submitted: null, feedback: null }));
  expect(personal.openHelp).toContainEqual(expect.objectContaining({ taskId: own.id, needed: "需要满员样例" }));
  expect(await buildPersonalRetrospective(owner.id, project.id, member.id)).toEqual(personal);
  await expect(buildPersonalRetrospective(member.id, project.id, owner.id)).rejects.toThrow();
  await expect(buildPersonalRetrospective(teacher.id, project.id)).rejects.toThrow();
});
