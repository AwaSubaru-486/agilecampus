import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { listProjectDeadlineWarnings } from "@/lib/project-deadlines";
import { createProject } from "@/lib/project";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";

beforeEach(resetDb);

it("区分实际逾期与三天内到期，按当前角色和项目筛选", async () => {
  const owner = await createUser({ email: "deadline-owner@test.local", password: "fixture-password", name: "组长" });
  const member = await createUser({ email: "deadline-member@test.local", password: "fixture-password", name: "组员" });
  const teacher = await createUser({ email: "deadline-teacher@test.local", password: "fixture-password", name: "导师" });
  const outsider = await createUser({ email: "deadline-outsider@test.local", password: "fixture-password", name: "外部用户" });
  const team = await createTeam(owner.id, "交付团队");
  await joinTeam(member.id, team.inviteCode);
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "截止日期预警" });
  const other = await createProject(owner.id, team.id, { name: "其他项目" });
  const onDate = "2026-11-21";
  const defaults = { projectId: project.id, assigneeId: member.id };
  const [review, dueToday] = await db.insert(tasks).values([
    { ...defaults, title: "逾期待验收", dueDate: "2026-11-19", status: "review" },
    { ...defaults, title: "今天截止", dueDate: onDate },
    { ...defaults, title: "三天后截止", dueDate: "2026-11-24", assigneeId: owner.id },
    { ...defaults, title: "四天后截止", dueDate: "2026-11-25" },
    { ...defaults, title: "已完成", dueDate: "2026-11-17", status: "done" },
    { ...defaults, title: "任务分组", dueDate: "2026-11-17", isTaskGroup: true },
    { ...defaults, title: "未定截止日期" },
    { ...defaults, projectId: other.id, title: "其他项目的逾期", dueDate: "2026-11-19" },
  ]).returning();

  const list = await listProjectDeadlineWarnings(owner.id, project.id, { onDate });
  expect(list.map(task => [task.title, task.daysRemaining])).toEqual([
    ["逾期待验收", -2], ["今天截止", 0], ["三天后截止", 3],
  ]);
  expect(list[0]).toMatchObject({ status: "review", assigneeName: "组员", dueDate: "2026-11-19" });
  const ownIds = [review.id, dueToday.id];
  expect((await listProjectDeadlineWarnings(owner.id, project.id, { onDate, viewMemberId: member.id })).map(task => task.id)).toEqual(ownIds);
  expect((await listProjectDeadlineWarnings(member.id, project.id, { onDate, viewMemberId: owner.id })).map(task => task.id)).toEqual(ownIds);
  expect(await listProjectDeadlineWarnings(teacher.id, project.id, { onDate })).toEqual([]);
  await expect(listProjectDeadlineWarnings(outsider.id, project.id, { onDate })).rejects.toThrow();

  await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, review.id));
  expect((await listProjectDeadlineWarnings(owner.id, project.id, { onDate })).map(task => task.daysRemaining)).toEqual([0, 3]);
  await db.update(projects).set({ status: "archived" }).where(eq(projects.id, project.id));
  expect(await listProjectDeadlineWarnings(owner.id, project.id, { onDate })).toEqual([]);
});
