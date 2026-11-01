import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const request = vi.hoisted(() => ({ userId: undefined as string | undefined, view: undefined as string | undefined }));
vi.mock("@/lib/auth", () => ({ auth: async () => request.userId ? { user: { id: request.userId } } : null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => request.view ? { value: request.view } : undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { db } from "@/db";
import { activityEvents, projectIterations, tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { changeIterationStatus, listProjectIterations, saveProjectIteration } from "@/lib/project-iterations";
import { changeIterationStatusAction, saveIterationAction } from "@/app/(app)/projects/[projectId]/iterations/actions";
import { resetDb } from "./helpers";

beforeEach(async () => { await resetDb(); request.userId = undefined; request.view = undefined; });
async function scene() {
  const owner = await createUser({ email: "iteration-owner@test.local", password: "password123", name: "组长" });
  const member = await createUser({ email: "iteration-member@test.local", password: "password123", name: "组员" });
  const teacher = await createUser({ email: "iteration-teacher@test.local", password: "password123", name: "老师" });
  const outsider = await createUser({ email: "iteration-outsider@test.local", password: "password123", name: "其他人" });
  const team = await createTeam(owner.id, "版本测试小组");
  await joinTeam(member.id, team.inviteCode); await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "版本测试项目" });
  const task = await createTask(owner.id, project.id, { title: "登录功能", assigneeId: member.id });
  return { owner, member, teacher, outsider, team, project, task };
}
const input = { version: "v1.0.0", title: "首个可用版本", goal: "完成核心流程", startDate: "2026-11-01", endDate: "2026-11-15", releaseNotes: "新增登录功能" };

describe("项目版本迭代", () => {
  it("创建计划并保存任务关联，成员和老师可读取真实进度", async () => {
    const f = await scene();
    const iteration = await saveProjectIteration(f.owner.id, f.project.id, { ...input, version: " V1.0.0 ", taskIds: [f.task.id, f.task.id] });
    expect(iteration.status).toBe("planned"); expect(iteration.version).toBe("v1.0.0");
    for (const actor of [f.member, f.teacher]) {
      const rows = await listProjectIterations(actor.id, f.project.id);
      expect(rows[0]).toMatchObject({ goal: input.goal, tasks: [{ id: f.task.id, status: "todo", assigneeName: "组员" }] });
    }
    await db.update(tasks).set({ status: "review" }).where(eq(tasks.id, f.task.id));
    expect((await listProjectIterations(f.owner.id, f.project.id))[0].tasks[0].status).toBe("review");
  });
  it("成员和老师不能管理迭代，项目外用户不能读取", async () => {
    const f = await scene();
    const iteration = await saveProjectIteration(f.owner.id, f.project.id, input);
    for (const actor of [f.member, f.teacher, f.outsider]) {
      await expect(saveProjectIteration(actor.id, f.project.id, input)).rejects.toThrow("组长");
      await expect(changeIterationStatus(actor.id, f.project.id, iteration.id, "start", iteration.updatedAt.toISOString())).rejects.toThrow("组长");
    }
    await expect(listProjectIterations(f.outsider.id, f.project.id)).rejects.toThrow();
  });
  it("禁止跨项目任务、任务分组和非法日期，失败时不留下迭代", async () => {
    const f = await scene();
    const other = await createProject(f.owner.id, f.team.id, { name: "其他项目" });
    const foreign = await createTask(f.owner.id, other.id, { title: "不能串项目" });
    for (const taskId of [foreign.id, randomUUID()]) await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, taskIds: [taskId] })).rejects.toThrow("当前项目");
    await db.update(tasks).set({ isTaskGroup: true }).where(eq(tasks.id, f.task.id));
    await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, taskIds: [f.task.id] })).rejects.toThrow("普通任务");
    await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, endDate: "2026-10-01" })).rejects.toThrow("结束日期");
    await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, startDate: "2026-02-30" })).rejects.toThrow();
    expect(await listProjectIterations(f.owner.id, f.project.id)).toEqual([]);
  });
  it("版本号在项目内唯一，不影响其他项目", async () => {
    const f = await scene();
    await saveProjectIteration(f.owner.id, f.project.id, input);
    await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, version: "V1.0.0" })).rejects.toThrow("相同版本号");
    const other = await createProject(f.owner.id, f.team.id, { name: "其他项目" });
    await expect(saveProjectIteration(f.owner.id, other.id, input)).resolves.toMatchObject({ version: input.version });
  });
  it("编辑保存目标、周期和任务范围，拒绝过期编辑及跨项目修改", async () => {
    const f = await scene();
    const created = await saveProjectIteration(f.owner.id, f.project.id, { ...input, taskIds: [f.task.id] });
    const edit = { id: created.id, updatedAt: created.updatedAt.toISOString() };
    await saveProjectIteration(f.owner.id, f.project.id, { ...input, goal: "调整目标", taskIds: [] }, edit);
    expect((await listProjectIterations(f.owner.id, f.project.id))[0]).toMatchObject({ goal: "调整目标", tasks: [] });
    await expect(saveProjectIteration(f.owner.id, f.project.id, input, edit)).rejects.toThrow("已被更新");
    const other = await createProject(f.owner.id, f.team.id, { name: "其他项目" });
    await expect(saveProjectIteration(f.owner.id, other.id, input, edit)).rejects.toThrow();
  });
  it("只能按计划、进行中、已发布推进，待验收任务不能发布", async () => {
    const f = await scene();
    const created = await saveProjectIteration(f.owner.id, f.project.id, { ...input, taskIds: [f.task.id] });
    await expect(changeIterationStatus(f.owner.id, f.project.id, created.id, "release", created.updatedAt.toISOString())).rejects.toThrow("先开始");
    const active = await changeIterationStatus(f.owner.id, f.project.id, created.id, "start", created.updatedAt.toISOString());
    await db.update(tasks).set({ status: "review" }).where(eq(tasks.id, f.task.id));
    await expect(changeIterationStatus(f.owner.id, f.project.id, active.id, "release", active.updatedAt.toISOString())).rejects.toThrow("验收完成");
    expect((await listProjectIterations(f.owner.id, f.project.id))[0].status).toBe("active");
    expect((await db.select().from(tasks).where(eq(tasks.id, f.task.id)))[0].status).toBe("review");
  });
  it("发布冻结任务记录，后续重开、改名或删除任务不改写历史", async () => {
    const f = await scene();
    const created = await saveProjectIteration(f.owner.id, f.project.id, { ...input, taskIds: [f.task.id] });
    const active = await changeIterationStatus(f.owner.id, f.project.id, created.id, "start", created.updatedAt.toISOString());
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, f.task.id));
    const released = await changeIterationStatus(f.owner.id, f.project.id, active.id, "release", active.updatedAt.toISOString());
    await db.update(tasks).set({ status: "doing", title: "后续修改" }).where(eq(tasks.id, f.task.id));
    expect((await listProjectIterations(f.member.id, f.project.id))[0]).toMatchObject({ status: "released", releaseNotes: input.releaseNotes, tasks: [{ title: "登录功能", status: "done" }] });
    await db.delete(tasks).where(eq(tasks.id, f.task.id));
    expect((await listProjectIterations(f.member.id, f.project.id))[0].tasks).toHaveLength(1);
    await expect(saveProjectIteration(f.owner.id, f.project.id, input, { id: released.id, updatedAt: released.updatedAt.toISOString() })).rejects.toThrow("历史记录");
    const events = await db.select().from(activityEvents);
    expect(events.some(event => event.summary?.includes("发布迭代"))).toBe(true);
  });
  it("并发开始请求只成功一次，防止重复状态和活动", async () => {
    const f = await scene();
    const created = await saveProjectIteration(f.owner.id, f.project.id, input);
    const results = await Promise.allSettled([1, 2].map(() => changeIterationStatus(f.owner.id, f.project.id, created.id, "start", created.updatedAt.toISOString())));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });
  it("服务端操作校验登录和视角，组长代组员时仍不能管理迭代", async () => {
    const f = await scene();
    const form = new FormData(); form.set("projectId", f.project.id); form.set("version", "v2.0.0"); form.set("title", "第二版");
    expect(await saveIterationAction(form)).toEqual({ error: "请先登录" });
    request.userId = f.owner.id; request.view = `student:${f.member.id}`;
    expect(await saveIterationAction(form)).toMatchObject({ error: expect.stringContaining("组长") });
    request.view = "admin";
    expect(await saveIterationAction(form)).toEqual({ ok: true });
    const row = (await listProjectIterations(f.owner.id, f.project.id))[0];
    request.userId = f.member.id;
    expect(await changeIterationStatusAction({ projectId: f.project.id, iterationId: row.id, updatedAt: row.updatedAt, action: "start" })).toMatchObject({ error: expect.stringContaining("组长") });
    expect((await db.select().from(projectIterations))[0].status).toBe("planned");
  });
});
