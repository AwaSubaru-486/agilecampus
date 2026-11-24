import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { blockers } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, getTaskDetail } from "@/lib/task";
import { listCollaborationHelp, listProjectBlockers, resolveBlocker } from "@/lib/blocker";
import { collaborationHelpHref, groupTaskHelp } from "@/lib/collaboration-help";
import { resetDb } from "./helpers";

describe("求助任务定位", () => {
  it("同一个任务的多个求助合为一项，无关联任务的求助有独立目标", () => {
    const task = { id: "help-1", projectId: "project", taskId: "task", taskTitle: "确认验收标准" };
    const global = { ...task, id: "help-3", taskId: null, taskTitle: null };
    const groups = groupTaskHelp([task, { ...task, id: "help-2" }, global]);
    expect(groups).toHaveLength(2); expect(groups[0].requests).toHaveLength(2);
    expect(collaborationHelpHref(task)).toBe("/collaboration?project=project&task=task#task-task");
    expect(collaborationHelpHref(global)).toBe("/collaboration?project=project&help=help-3#help-help-3");
  });
});

describe("协作中心求助数据", () => {
  beforeEach(resetDb);
  it("本人和队友的求助均可从看板定位；限定项目并排除无权限团队", async () => {
    const owner = await createUser({ name: "组长", email: "owner@help.test", password: "password123" });
    const member = await createUser({ name: "组员", email: "member@help.test", password: "password123" });
    const outsider = await createUser({ name: "外部", email: "outsider@help.test", password: "password123" });
    const team = await createTeam(owner.id, "汪汪队"); await joinTeam(member.id, team.inviteCode);
    const project = await createProject(owner.id, team.id, { name: "敏捷开发平台" });
    const other = await createProject(owner.id, team.id, { name: "同团队其他项目" });
    const secretTeam = await createTeam(outsider.id, "其他团队");
    const secret = await createProject(outsider.id, secretTeam.id, { name: "不可见项目" });
    const task = await createTask(owner.id, project.id, { title: "需要协助的任务" });
    await db.insert(blockers).values([
      { projectId: project.id, taskId: task.id, raisedById: owner.id, reason: "tech" },
      { projectId: project.id, taskId: task.id, raisedById: member.id, reason: "unclear" },
      { projectId: other.id, raisedById: owner.id, reason: "resource" },
      { projectId: secret.id, raisedById: outsider.id, reason: "tech" },
    ]);
    const all = await listCollaborationHelp(owner.id);
    expect(all).toHaveLength(3); expect(all.map(row => row.projectName)).not.toContain("不可见项目");
    const scoped = await listCollaborationHelp(owner.id, project.id);
    expect(scoped).toHaveLength(2); expect(scoped.some(row => row.raisedById === owner.id)).toBe(true);
    expect(groupTaskHelp(scoped)[0]).toMatchObject({ taskId: task.id, title: task.title });
    expect(await listCollaborationHelp(owner.id, secret.id)).toEqual([]);
    expect(await listCollaborationHelp(outsider.id, project.id)).toEqual([]);
  });
  it("队友解决后同时退出协作中心和项目求助列表，不把任务自动标为完成", async () => {
    const owner = await createUser({ name: "组长", email: "owner@help.test", password: "password123" });
    const member = await createUser({ name: "组员", email: "member@help.test", password: "password123" });
    const team = await createTeam(owner.id, "汪汪队"); await joinTeam(member.id, team.inviteCode);
    const project = await createProject(owner.id, team.id, { name: "敏捷开发平台" });
    const task = await createTask(owner.id, project.id, { title: "协作任务" });
    const [help] = await db.insert(blockers).values({ projectId: project.id, taskId: task.id, raisedById: owner.id, reason: "tech", helpNeeded: "需要检查接口" }).returning();
    await resolveBlocker(member.id, help.id, { note: "已说明接口参数" });
    expect(await listCollaborationHelp(member.id, project.id)).toEqual([]);
    expect(await listProjectBlockers(owner.id, project.id, { status: ["open"] })).toEqual([]);
    expect((await getTaskDetail(owner.id, task.id)).status).toBe("todo");
  });
});
