import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import {
  createProject,
  deleteProject,
  listTeamProjects,
  getProjectForUser,
  createMilestone,
  listProjectMilestones,
} from "@/lib/project";
import { resetDb } from "./helpers";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { projects, tasks, projectBriefs, taskTreeDrafts, users, teams, teamMembers } from "@/db/schema";
import { createTask } from "@/lib/task";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

// 常用布景：owner(admin) 建团队，student 加入，outsider 在野
async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  return { owner, team, student, outsider };
}

describe("createProject", () => {
  beforeEach(resetDb);

  it("admin 可创建项目，默认 active", async () => {
    const { owner, team } = await scene();
    const p = await createProject(owner.id, team.id, {
      name: "赤壁演习",
      description: "冬季学期项目",
      startDate: "2026-09-01",
      endDate: "2027-01-15",
    });
    expect(p.name).toBe("赤壁演习");
    expect(p.status).toBe("active");
    expect(p.teamId).toBe(team.id);
  });

  it("student 建项目被拒（仅 admin）", async () => {
    const { team, student } = await scene();
    await expect(
      createProject(student.id, team.id, { name: "私设项目" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("listTeamProjects", () => {
  beforeEach(resetDb);

  it("团队成员可列出团队项目", async () => {
    const { owner, team, student } = await scene();
    await createProject(owner.id, team.id, { name: "甲计划" });
    await createProject(owner.id, team.id, { name: "乙计划" });
    const list = await listTeamProjects(student.id, team.id);
    expect(list).toHaveLength(2);
  });

  it("非成员被拒", async () => {
    const { owner, team, outsider } = await scene();
    await createProject(owner.id, team.id, { name: "甲计划" });
    await expect(listTeamProjects(outsider.id, team.id)).rejects.toThrow("没有权限");
  });
});

describe("getProjectForUser", () => {
  beforeEach(resetDb);

  it("成员取得项目与自身角色", async () => {
    const { owner, team, student } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    const access = await getProjectForUser(student.id, p.id);
    expect(access?.project.id).toBe(p.id);
    expect(access?.role).toBe("student");
  });

  it("非成员得 null（不泄露存在性）", async () => {
    const { owner, team, outsider } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    expect(await getProjectForUser(outsider.id, p.id)).toBeNull();
  });

  it("项目不存在得 null", async () => {
    const { owner } = await scene();
    expect(
      await getProjectForUser(owner.id, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});

describe("milestones", () => {
  beforeEach(resetDb);

  it("admin 可建里程碑并列出", async () => {
    const { owner, team } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    const m = await createMilestone(owner.id, p.id, {
      title: "中期答辩",
      targetDate: "2026-11-15",
    });
    expect(m.status).toBe("open");
    const list = await listProjectMilestones(owner.id, p.id);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("中期答辩");
  });

  it("student 建里程碑被拒", async () => {
    const { owner, team, student } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    await expect(
      createMilestone(student.id, p.id, { title: "私设节点" }),
    ).rejects.toThrow("没有权限");
  });

  it("teacher 建里程碑被拒（仅 admin）", async () => {
    const { owner, team } = await scene();
    const teacher = await makeUser("teacher@example.com");
    await joinTeam(teacher.id, team.inviteCode);
    await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    await expect(
      createMilestone(teacher.id, p.id, { title: "越权节点" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("deleteProject", () => {
  beforeEach(resetDb);

  it("admin 可成功删除项目", async () => {
    const { owner, team } = await scene();
    const p = await createProject(owner.id, team.id, { name: "准备删除的项目" });
    const deleted = await deleteProject(owner.id, p.id);
    expect(deleted.id).toBe(p.id);
    expect(await getProjectForUser(owner.id, p.id)).toBeNull();
  });

  it("删除已有任务与草案的项目时清理项目资料，保留团队、账号和其他项目", async () => {
    const { owner, team } = await scene();
    const p = await createProject(owner.id, team.id, { name: "有资料的项目" });
    const other = await createProject(owner.id, team.id, { name: "保留项目" });
    await createTask(owner.id, p.id, { title: "待删除任务" });
    await createMilestone(owner.id, p.id, { title: "待删除里程碑" });
    const [brief] = await db.insert(projectBriefs).values({ projectId: p.id, createdById: owner.id, content: "用于验证删除清理" }).returning();
    await db.insert(taskTreeDrafts).values({ projectId: p.id, briefId: brief.id, createdById: owner.id, payload: {} });
    await deleteProject(owner.id, p.id);
    expect(await db.select().from(tasks).where(eq(tasks.projectId, p.id))).toHaveLength(0);
    expect(await db.select().from(projectBriefs).where(eq(projectBriefs.projectId, p.id))).toHaveLength(0);
    expect(await db.select().from(taskTreeDrafts).where(eq(taskTreeDrafts.projectId, p.id))).toHaveLength(0);
    expect(await listProjectMilestones(owner.id, other.id)).toEqual([]);
    expect(await db.select().from(projects).where(eq(projects.id, other.id))).toHaveLength(1);
    expect(await db.select().from(teams).where(eq(teams.id, team.id))).toHaveLength(1);
    expect(await db.select().from(users).where(eq(users.id, owner.id))).toHaveLength(1);
    expect(await db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id))).toHaveLength(2);
  });

  it("student 删除项目被拒（仅 admin）", async () => {
    const { owner, team, student } = await scene();
    const p = await createProject(owner.id, team.id, { name: "学生试图删除" });
    await expect(deleteProject(student.id, p.id)).rejects.toThrow("只有组长（Admin）可以删除项目");
  });

  it("非成员删除项目被拒", async () => {
    const { owner, team, outsider } = await scene();
    const p = await createProject(owner.id, team.id, { name: "局外人试图删除" });
    await expect(deleteProject(outsider.id, p.id)).rejects.toThrow();
  });
});

