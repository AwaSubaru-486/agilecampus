import { beforeEach, describe, expect, it } from "vitest";
import {
  buildTutorialCourses,
  type TutorialProject,
} from "@/lib/tutorials/catalog";
import {
  getTutorialProgress,
  updateTutorialProgress,
  updateTutorialExample,
} from "@/lib/tutorials/progress";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { EXAMPLE_FIELDS, EXAMPLE_FLOW } from "@/lib/tutorials/example-flow";
import { db } from "@/db";
import { users, projects, teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers";

const sample: TutorialProject = {
  id: "00000000-0000-4000-8000-000000000001",
  teamId: "00000000-0000-4000-8000-000000000002",
  name: "实训",
  role: "admin",
};
const user = (name: string) =>
  createUser({ name, email: `${name}@tutorial.test`, password: "password123" });

async function finishExample(id: string) {
  for (let phase = 0; phase < EXAMPLE_FLOW.length; phase++)
    await updateTutorialExample(
      id,
      phase,
      Object.fromEntries(
        EXAMPLE_FIELDS[phase].map((field) => [field.key, field.placeholder]),
      ),
    );
}
describe("示例项目路线", () => {
  it("三种真实角色都可以走同一个示例，按项目生命周期练习三方分工", () => {
    const leader = buildTutorialCourses(sample)[0];
    expect(buildTutorialCourses({ ...sample, role: "teacher" })[0]).toEqual(
      leader,
    );
    expect(buildTutorialCourses({ ...sample, role: "student" })[0]).toEqual(
      leader,
    );
    expect(leader.steps.map((step) => step.id)).toEqual([
      ...EXAMPLE_FLOW.map((item) => item[0]),
      "records",
    ]);
    expect(
      leader.steps.slice(0, -1).every((step) => step.action === "result"),
    ).toBe(true);
  });
  it("无项目账号也有完整路线；全部目标位于独立示例区", () => {
    const steps = buildTutorialCourses(null)[0].steps;
    expect(steps).toHaveLength(15);
    expect(
      steps.every((step) => step.route.startsWith("/tutorials/example?phase=")),
    ).toBe(true);
    expect(new Set(steps.map((step) => step.id)).size).toBe(15);
  });
});

describe("账号教程记录", () => {
  beforeEach(resetDb);
  it("首次提醒只对未处理账号出现，跳过持久化且不影响另一个账号", async () => {
    const a = await user("a"),
      b = await user("b");
    expect((await getTutorialProgress(a.id)).status).toBe("new");
    await updateTutorialProgress(a.id, { type: "dismiss", actorId: b.id });
    expect((await getTutorialProgress(a.id)).status).toBe("dismissed");
    expect((await getTutorialProgress(b.id)).status).toBe("new");
  });
  it("跨请求保存步骤；暂停保留原位置，继续清除暂停标记", async () => {
    const a = await user("a");
    await updateTutorialProgress(a.id, {
      type: "save",
      courseId: "welcome",
      step: 0,
      projectId: null,
    });
    await updateTutorialProgress(a.id, { type: "pause" });
    expect((await getTutorialProgress(a.id)).active).toEqual({
      courseId: "welcome",
      step: 0,
      projectId: null,
      paused: true,
      journeyVersion: 2,
    });
    await updateTutorialProgress(a.id, {
      type: "save",
      courseId: "welcome",
      step: 0,
      projectId: null,
    });
    expect((await getTutorialProgress(a.id)).active?.paused).toBeFalsy();
  });
  it("并发完成不同课程不丢失记录；重复完成不增加重复项", async () => {
    const a = await user("a");
    await Promise.all([
      updateTutorialProgress(a.id, { type: "complete", courseId: "teams" }),
      updateTutorialProgress(a.id, { type: "complete", courseId: "settings" }),
    ]);
    await updateTutorialProgress(a.id, { type: "complete", courseId: "teams" });
    expect((await getTutorialProgress(a.id)).completed.sort()).toEqual([
      "settings",
      "teams",
    ]);
    await finishExample(a.id);
    await updateTutorialProgress(a.id, {
      type: "complete",
      courseId: "welcome",
    });
    expect((await getTutorialProgress(a.id)).status).toBe("completed");
  });
  it("拒绝不存在课程、越界步骤以及不存在的账号", async () => {
    const a = await user("a");
    await expect(
      updateTutorialProgress(a.id, {
        type: "save",
        courseId: "fake",
        step: 0,
        projectId: null,
      }),
    ).rejects.toThrow();
    await expect(
      updateTutorialProgress(a.id, {
        type: "save",
        courseId: "settings",
        step: 9,
        projectId: null,
      }),
    ).rejects.toThrow();
    await expect(
      updateTutorialProgress(sample.id, { type: "dismiss" }),
    ).rejects.toThrow();
  });
  it("不能存入无权项目；导师不能启动组长规划或组员执行课程", async () => {
    const a = await user("a"),
      teacher = await user("teacher"),
      outsider = await user("outsider");
    const team = await createTeam(a.id, "实训团队");
    await joinTeam(teacher.id, team.inviteCode);
    await updateMemberRole(a.id, team.id, teacher.id, "teacher");
    const project = await createProject(a.id, team.id, { name: "实训项目" });
    await expect(
      updateTutorialProgress(outsider.id, {
        type: "save",
        courseId: "welcome",
        step: 0,
        projectId: project.id,
      }),
    ).rejects.toThrow();
    for (const courseId of ["planning", "execution"])
      await expect(
        updateTutorialProgress(teacher.id, {
          type: "save",
          courseId,
          step: 0,
          projectId: project.id,
        }),
      ).rejects.toThrow();
    expect(
      (
        await updateTutorialProgress(teacher.id, {
          type: "save",
          courseId: "review",
          step: 0,
          projectId: project.id,
        })
      ).active?.courseId,
    ).toBe("review");
  });
  it("示例完成不误标真实项目功能课程", async () => {
    const a = await user("a");
    await updateTutorialProgress(a.id, {
      type: "save",
      courseId: "welcome",
      step: 0,
      projectId: null,
    });
    await finishExample(a.id);
    const progress = await updateTutorialProgress(a.id, {
      type: "complete",
      courseId: "welcome",
    });
    expect(progress.completed).toEqual(["welcome"]);
    expect(progress.completed).not.toContain("planning");
    expect(progress.completed).not.toContain("iterations");
  });
});

describe("示例操作持久化", () => {
  beforeEach(resetDb);
  it("不能跳过操作或提前完成，保存结果与教程位置相互独立", async () => {
    const a = await user("a"),
      b = await user("b");
    await expect(
      updateTutorialExample(a.id, 1, { project: "项目名称" }),
    ).rejects.toThrow("上一项");
    await expect(
      updateTutorialProgress(a.id, {
        type: "save",
        courseId: "welcome",
        step: 1,
        projectId: null,
      }),
    ).rejects.toThrow();
    await expect(
      updateTutorialProgress(a.id, { type: "complete", courseId: "welcome" }),
    ).rejects.toThrow();
    await Promise.all([
      updateTutorialExample(a.id, 0, { team: "示例团队" }),
      updateTutorialExample(a.id, 0, { team: "示例团队" }),
    ]);
    const progress = await getTutorialProgress(a.id);
    expect(progress.example?.phase).toBe(1);
    expect(progress.example?.events).toHaveLength(1);
    expect((await getTutorialProgress(b.id)).example).toBeUndefined();
    await updateTutorialProgress(a.id, {
      type: "save",
      courseId: "welcome",
      step: 1,
      projectId: null,
    });
    expect((await getTutorialProgress(a.id)).example).toEqual(progress.example);
  });
  it("完整示例保存成果与十四项历史；明确重建不会重置其他功能课程", async () => {
    const a = await user("a");
    await finishExample(a.id);
    await updateTutorialProgress(a.id, {
      type: "complete",
      courseId: "welcome",
    });
    await updateTutorialProgress(a.id, { type: "complete", courseId: "teams" });
    expect((await getTutorialProgress(a.id)).example?.events).toHaveLength(14);
    const progress = await updateTutorialProgress(a.id, {
      type: "restart-example",
    });
    expect(progress.example?.phase).toBe(0);
    expect(progress.completed).toEqual(["teams"]);
    expect(await db.select().from(projects)).toEqual([]);
    expect(await db.select().from(teams)).toEqual([]);
    expect(progress.active).toEqual({
      courseId: "welcome",
      step: 0,
      projectId: null,
      journeyVersion: 2,
    });
  });
  it("旧教程第十一步迁移到暂停的新路线，避免沿用旧位置", async () => {
    const a = await user("a");
    await db
      .update(users)
      .set({
        tutorialProgress: {
          status: "started",
          completed: [],
          active: { courseId: "welcome", step: 10, projectId: null },
        },
      })
      .where(eq(users.id, a.id));
    expect((await getTutorialProgress(a.id)).active).toEqual({
      courseId: "welcome",
      step: 0,
      projectId: null,
      paused: true,
      journeyVersion: 2,
    });
  });
});

describe("教程版本升级", () => {
  beforeEach(resetDb);
  it("旧路线已完成不代表新示例已完成，但保留功能课程记录", async () => {
    const a = await user("upgrade");
    await db
      .update(users)
      .set({
        tutorialProgress: {
          status: "completed",
          completed: ["welcome", "teams"],
          active: null,
        },
      })
      .where(eq(users.id, a.id));
    const progress = await getTutorialProgress(a.id);
    expect(progress.completed).toEqual(["teams"]);
    expect(progress.status).toBe("started");
  });
});
