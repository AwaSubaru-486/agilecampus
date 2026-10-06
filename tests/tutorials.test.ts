import { beforeEach, describe, expect, it } from "vitest";
import { buildTutorialCourses, type TutorialProject } from "@/lib/tutorials/catalog";
import { getTutorialProgress, updateTutorialProgress } from "@/lib/tutorials/progress";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { resetDb } from "./helpers";

const sample: TutorialProject = { id: "00000000-0000-4000-8000-000000000001", teamId: "00000000-0000-4000-8000-000000000002", name: "实训", role: "admin" };
const user = (name: string) => createUser({ name, email: `${name}@tutorial.test`, password: "password123" });

describe("角色教程路线", () => {
  it("组长完整路线包含规划和执行；导师包含评审而不包含任务执行", () => {
    const leader = buildTutorialCourses(sample)[0].steps.map((step) => step.id);
    const teacher = buildTutorialCourses({ ...sample, role: "teacher" })[0].steps.map((step) => step.id);
    const member = buildTutorialCourses({ ...sample, role: "student" })[0].steps.map((step) => step.id);
    expect(leader).toContain("planning:brief"); expect(leader).toContain("execution:console");
    expect(teacher).toContain("review:evaluation"); expect(teacher).not.toContain("planning:brief"); expect(teacher).not.toContain("execution:console");
    expect(member).toContain("execution:console"); expect(member).not.toContain("review:review");
  });
  it("无项目用户仍能学通用功能，不会进入项目占位地址", () => {
    const steps = buildTutorialCourses(null)[0].steps;
    expect(steps.some((step) => step.id === "teams:join")).toBe(true);
    expect(steps.some((step) => step.id === "connections:token")).toBe(true);
    expect(steps.every((step) => !step.route.startsWith("/projects/"))).toBe(true);
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
  });
});

describe("账号教程记录", () => {
  beforeEach(resetDb);
  it("首次提醒只对未处理账号出现，跳过持久化且不影响另一个账号", async () => {
    const a = await user("a"), b = await user("b");
    expect((await getTutorialProgress(a.id)).status).toBe("new");
    await updateTutorialProgress(a.id, { type: "dismiss", actorId: b.id });
    expect((await getTutorialProgress(a.id)).status).toBe("dismissed");
    expect((await getTutorialProgress(b.id)).status).toBe("new");
  });
  it("跨请求保存步骤；暂停保留原位置，继续清除暂停标记", async () => {
    const a = await user("a");
    await updateTutorialProgress(a.id, { type: "save", courseId: "welcome", step: 2, projectId: null });
    await updateTutorialProgress(a.id, { type: "pause" });
    expect((await getTutorialProgress(a.id)).active).toEqual({ courseId: "welcome", step: 2, projectId: null, paused: true });
    await updateTutorialProgress(a.id, { type: "save", courseId: "welcome", step: 2, projectId: null });
    expect((await getTutorialProgress(a.id)).active?.paused).toBeFalsy();
  });
  it("并发完成不同课程不丢失记录；重复完成不增加重复项", async () => {
    const a = await user("a");
    await Promise.all([updateTutorialProgress(a.id, { type: "complete", courseId: "teams" }), updateTutorialProgress(a.id, { type: "complete", courseId: "settings" })]);
    await updateTutorialProgress(a.id, { type: "complete", courseId: "teams" });
    expect((await getTutorialProgress(a.id)).completed.sort()).toEqual(["settings", "teams"]);
    await updateTutorialProgress(a.id, { type: "complete", courseId: "welcome" });
    expect((await getTutorialProgress(a.id)).status).toBe("completed");
  });
  it("拒绝不存在课程、越界步骤以及不存在的账号", async () => {
    const a = await user("a");
    await expect(updateTutorialProgress(a.id, { type: "save", courseId: "fake", step: 0, projectId: null })).rejects.toThrow();
    await expect(updateTutorialProgress(a.id, { type: "save", courseId: "settings", step: 9, projectId: null })).rejects.toThrow();
    await expect(updateTutorialProgress(sample.id, { type: "dismiss" })).rejects.toThrow();
  });
  it("不能存入无权项目；导师不能启动组长规划或组员执行课程", async () => {
    const a = await user("a"), teacher = await user("teacher"), outsider = await user("outsider");
    const team = await createTeam(a.id, "实训团队");
    await joinTeam(teacher.id, team.inviteCode); await updateMemberRole(a.id, team.id, teacher.id, "teacher");
    const project = await createProject(a.id, team.id, { name: "实训项目" });
    await expect(updateTutorialProgress(outsider.id, { type: "save", courseId: "welcome", step: 0, projectId: project.id })).rejects.toThrow();
    for (const courseId of ["planning", "execution"]) await expect(updateTutorialProgress(teacher.id, { type: "save", courseId, step: 0, projectId: project.id })).rejects.toThrow();
    expect((await updateTutorialProgress(teacher.id, { type: "save", courseId: "review", step: 0, projectId: project.id })).active?.courseId).toBe("review");
  });
  it("完整旅程同步标记学过的功能，不误标没有项目的课程", async () => {
    const a = await user("a");
    await updateTutorialProgress(a.id, { type: "save", courseId: "welcome", step: 0, projectId: null });
    const progress = await updateTutorialProgress(a.id, { type: "complete", courseId: "welcome" });
    expect(progress.completed).toEqual(expect.arrayContaining(["welcome", "teams", "risks", "connections", "settings"]));
    expect(progress.completed).not.toContain("planning"); expect(progress.completed).not.toContain("iterations");
  });
});
