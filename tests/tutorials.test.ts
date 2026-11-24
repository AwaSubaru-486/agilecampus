import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, tasks, projects, teams, activityEvents } from "@/db/schema";
import { getTutorialProgress, updateTutorialProgress, recordTutorialCreation } from "@/lib/tutorials/progress";
import { buildTutorialCourses } from "@/lib/tutorials/catalog";
import { buildWelcomeSteps } from "@/lib/tutorials/example-flow";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { generateTutorialTaskTreeDraft } from "@/lib/task-tree";
import { resetDb } from "./helpers";

const user = (name: string) => createUser({ name, email: `${name}@tutorial.test`, password: "password123" });
const sample = { id: "00000000-0000-4000-8000-000000000001", teamId: "00000000-0000-4000-8000-000000000002", name: "项目", role: "admin" as const };
async function showcase(actorId: string) {
  const team = await createTeam(actorId, "汪汪队");
  const project = await createProject(actorId, team.id, { name: "敏捷开发平台" });
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: "确认项目验收标准", assigneeId: actorId }).returning();
  await createProject(actorId, team.id, { name: "敏捷开发平台" });
  return { team, project, task };
}

describe("展示教程与账号进度", () => {
  beforeEach(resetDb);
  it("功能课程保持角色权限，展示课程要求可访问项目", () => {
    expect(buildTutorialCourses(sample)[0].needsProject).toBe(true);
    expect(buildTutorialCourses(sample).find(course => course.id === "planning")?.roles).toEqual(["admin"]);
    expect(buildTutorialCourses({ ...sample, role: "student" }).find(course => course.id === "records")?.roles).toEqual(["admin", "teacher"]);
  });
  it("首次提醒、跳过和不存在账号保持隔离", async () => {
    const a = await user("a"), b = await user("b");
    expect((await getTutorialProgress(a.id)).status).toBe("new");
    await updateTutorialProgress(a.id, { type: "dismiss", actorId: b.id });
    expect((await getTutorialProgress(a.id)).status).toBe("dismissed");
    expect((await getTutorialProgress(b.id)).status).toBe("new");
    await expect(updateTutorialProgress(sample.id, { type: "dismiss" })).rejects.toThrow();
  });
  it("默认绑定有任务的汪汪队项目，暂停与继续保存相同项目", async () => {
    const a = await user("a"); const { project, task } = await showcase(a.id);
    const start = await updateTutorialProgress(a.id, { type: "restart-example" });
    expect(start.journey?.projectId).toBe(project.id); expect(start.journey?.taskId).toBe(task.id);
    await updateTutorialProgress(a.id, { type: "save", courseId: "welcome", step: 3, projectId: project.id });
    await updateTutorialProgress(a.id, { type: "pause" });
    const paused = await getTutorialProgress(a.id); expect(paused.active?.paused).toBe(true);
    const resumed = await updateTutorialProgress(a.id, { type: "save", courseId: "welcome", step: 3, projectId: project.id });
    expect(resumed.active?.paused).toBeUndefined(); expect(resumed.journey).toEqual(paused.journey);
  });
  it("展示无需模型配置或真实交付，完成与重新开始不改团队、项目、任务和业务活动", async () => {
    const a = await user("a"); const { project } = await showcase(a.id);
    const snapshot = async () => Promise.all([db.select().from(tasks), db.select().from(projects), db.select().from(teams), db.select().from(activityEvents)]);
    const before = await snapshot();
    const start = await updateTutorialProgress(a.id, { type: "restart-example" });
    const steps = buildWelcomeSteps(start.journey!);
    for (let step = 1; step < steps.length; step++) await updateTutorialProgress(a.id, { type: "save", courseId: "welcome", step, projectId: project.id });
    const complete = await updateTutorialProgress(a.id, { type: "complete", courseId: "welcome" });
    expect(complete.status).toBe("completed"); expect(complete.completed).toContain("welcome");
    await updateTutorialProgress(a.id, { type: "restart-example" });
    expect(await snapshot()).toEqual(before);
    await expect(generateTutorialTaskTreeDraft(a.id, project.id, "制作一个校园活动报名页面")).rejects.toThrow();
  });
  it("并发完成其他课程不丢失，主线尚未到最后一步不能完成", async () => {
    const a = await user("a"); await showcase(a.id);
    await Promise.all([updateTutorialProgress(a.id, { type: "complete", courseId: "teams" }), updateTutorialProgress(a.id, { type: "complete", courseId: "settings" })]);
    await updateTutorialProgress(a.id, { type: "complete", courseId: "teams" });
    expect((await getTutorialProgress(a.id)).completed.sort()).toEqual(["settings", "teams"]);
    await updateTutorialProgress(a.id, { type: "restart-example" });
    await expect(updateTutorialProgress(a.id, { type: "complete", courseId: "welcome" })).rejects.toThrow();
  });
  it("拒绝未知课程、越界步骤、无权限项目和替换展示项目", async () => {
    const a = await user("a"), b = await user("b"); const { team, project } = await showcase(a.id);
    const other = await createProject(a.id, team.id, { name: "其他项目" });
    await expect(updateTutorialProgress(a.id, { type: "save", courseId: "fake", step: 0, projectId: null })).rejects.toThrow();
    await expect(updateTutorialProgress(a.id, { type: "save", courseId: "settings", step: 9, projectId: null })).rejects.toThrow();
    await expect(updateTutorialProgress(b.id, { type: "save", courseId: "welcome", step: 1, projectId: project.id })).rejects.toThrow();
    await expect(updateTutorialProgress(a.id, { type: "save", courseId: "welcome", step: 1, projectId: other.id })).rejects.toThrow();
    expect((await getTutorialProgress(b.id)).journey?.projectId).toBeNull();
    await expect(updateTutorialProgress(b.id, { type: "restart-example" })).rejects.toThrow();
  });
  it("老师和组员展示自己的角色课程，仍不能越权启动功能课程", async () => {
    const a = await user("a"), t = await user("teacher"), s = await user("student"); const { team, project } = await showcase(a.id);
    await joinTeam(t.id, team.inviteCode); await updateMemberRole(a.id, team.id, t.id, "teacher"); await joinTeam(s.id, team.inviteCode);
    for (const courseId of ["planning", "execution", "role-views"]) await expect(updateTutorialProgress(t.id, { type: "save", courseId, step: 0, projectId: project.id })).rejects.toThrow();
    await expect(updateTutorialProgress(s.id, { type: "save", courseId: "records", step: 0, projectId: project.id })).rejects.toThrow();
    expect((await updateTutorialProgress(t.id, { type: "restart-example" })).journey?.role).toBe("teacher");
    expect((await updateTutorialProgress(s.id, { type: "restart-example" })).journey?.role).toBe("student");
  });
  it("旧主线重置并暂停，保留其他课程和旧团队项目", async () => {
    const a = await user("migration"); const { team, project } = await showcase(a.id);
    for (const version of [4, 5] as const) {
      await db.update(users).set({ tutorialProgress: { status: "completed", completed: ["welcome", "teams"], journey: { version, teamId: team.id, projectId: project.id }, active: { courseId: "welcome", step: 15, projectId: project.id, journeyVersion: version } } }).where(eq(users.id, a.id));
      const progress = await getTutorialProgress(a.id);
      expect(progress.journey?.version).toBe(6); expect(progress.journey?.projectId).toBe(project.id);
      expect(progress.active).toEqual({ courseId: "welcome", step: 0, projectId: project.id, paused: true, journeyVersion: 6 });
      expect(progress.completed).toEqual(["teams"]);
    }
    const other = await createProject(a.id, team.id, { name: "刚创建的普通项目" });
    await recordTutorialCreation(a.id, "project", other.id);
    expect((await getTutorialProgress(a.id)).journey?.projectId).toBe(project.id);
  });
});
