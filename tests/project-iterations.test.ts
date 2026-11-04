import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const request = vi.hoisted(() => ({ userId: undefined as string | undefined, view: undefined as string | undefined }));
vi.mock("@/lib/auth", () => ({ auth: async () => request.userId ? { user: { id: request.userId } } : null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => request.view ? { value: request.view } : undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { db } from "@/db";
import { activityEvents, iterationTasks, tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { changeIterationStatus, listProjectIterations, saveProjectIteration, saveIterationExecution } from "@/lib/project-iterations";
import { changeIterationStatusAction, saveIterationAction, saveIterationExecutionAction } from "@/app/(app)/projects/[projectId]/iterations/actions";
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
  const task = await createTask(owner.id, project.id, { title: "开发细节任务", assigneeId: member.id });
  return { owner, member, teacher, outsider, team, project, task };
}
const input = { version: "v1.0.0", title: "团队协作首版", goal: "让团队共同管理项目成果", startDate: "2026-11-01", endDate: "2026-11-15", features: [{ name: "团队协作", summary: "成员可以共享项目资料和成果。", change: "added" as const }] };
const execution = { executionNotes: "已完成主要场景的使用体验调整。", validationNotes: "用组长和组员身份验证共享流程，结果正常。", releaseNotes: "支持团队共享项目资料与成果。", releaseUrl: "https://example.com/releases/v1" };
async function start(f: Awaited<ReturnType<typeof scene>>) {
  const created = await saveProjectIteration(f.owner.id, f.project.id, input);
  return changeIterationStatus(f.owner.id, f.project.id, created.id, "start", created.updatedAt.toISOString());
}
async function publish(f: Awaited<ReturnType<typeof scene>>) {
  const active = await start(f);
  const saved = await saveIterationExecution(f.owner.id, f.project.id, active.id, active.updatedAt.toISOString(), execution);
  return changeIterationStatus(f.owner.id, f.project.id, saved.id, "release", saved.updatedAt.toISOString());
}

describe("以功能模块推进版本迭代", () => {
  it("版本保存模块变化，成员和老师可查看，不返回任务安排", async () => {
    const f = await scene();
    const created = await saveProjectIteration(f.owner.id, f.project.id, { ...input, version: " V1.0.0 " });
    expect(created).toMatchObject({ status: "planned", version: "v1.0.0" });
    for (const actor of [f.member, f.teacher]) {
      const [row] = await listProjectIterations(actor.id, f.project.id);
      expect(row.features).toEqual([expect.objectContaining(input.features[0])]);
      expect(row).not.toHaveProperty("tasks");
    }
  });
  it("成员和老师不能管理版本、记录推进或发布，项目外用户不能读取", async () => {
    const f = await scene(); const active = await start(f);
    for (const actor of [f.member, f.teacher, f.outsider]) {
      await expect(saveProjectIteration(actor.id, f.project.id, input)).rejects.toThrow("组长");
      await expect(saveIterationExecution(actor.id, f.project.id, active.id, active.updatedAt.toISOString(), execution)).rejects.toThrow("组长");
      await expect(changeIterationStatus(actor.id, f.project.id, active.id, "release", active.updatedAt.toISOString())).rejects.toThrow("组长");
    }
    await expect(listProjectIterations(f.outsider.id, f.project.id)).rejects.toThrow();
  });
  it("规划、推进和发布都不创建、分配或修改任务，也不受任务验收状态影响", async () => {
    const f = await scene(); const before = await db.select().from(tasks);
    const released = await publish(f);
    expect(released.status).toBe("released");
    expect(await db.select().from(tasks)).toEqual(before);
    expect(await db.select().from(iterationTasks)).toEqual([]);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.type, "project_updated"));
    expect(events.every(event => event.taskId === null)).toBe(true);
  });
  it("保留旧任务关联但不把技术任务名称转换成功能模块", async () => {
    const f = await scene(); const created = await saveProjectIteration(f.owner.id, f.project.id, input);
    await db.insert(iterationTasks).values({ iterationId: created.id, taskId: f.task.id });
    const [row] = await listProjectIterations(f.member.id, f.project.id);
    expect(row.features.map(feature => feature.name)).toEqual(["团队协作"]);
    expect(JSON.stringify(row)).not.toContain("开发细节任务");
    await publish({ ...f, project: await createProject(f.owner.id, f.team.id, { name: "另一个项目" }) });
    expect(await db.select().from(iterationTasks)).toHaveLength(1);
  });
  it("校验模块名称、变化说明、重复模块和有效日期", async () => {
    const f = await scene();
    for (const value of [
      { ...input, features: [{ ...input.features[0], name: "" }] },
      { ...input, features: [{ ...input.features[0], summary: "" }] },
      { ...input, features: [input.features[0], input.features[0]] },
      { ...input, endDate: "2026-10-01" }, { ...input, startDate: "2026-02-30" },
    ]) await expect(saveProjectIteration(f.owner.id, f.project.id, value)).rejects.toThrow();
    expect(await listProjectIterations(f.owner.id, f.project.id)).toEqual([]);
  });
  it("草稿可先保存，但开始迭代必须明确目标和功能范围", async () => {
    const f = await scene(); const draft = await saveProjectIteration(f.owner.id, f.project.id, { version: "v0.1", title: "待规划" });
    await expect(changeIterationStatus(f.owner.id, f.project.id, draft.id, "start", draft.updatedAt.toISOString())).rejects.toThrow("目标和功能模块");
    const active = await start(f);
    await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, features: [] }, { id: active.id, updatedAt: active.updatedAt.toISOString() })).rejects.toThrow("保留目标和功能模块");
  });
  it("只能基于同项目的已发布版本规划，且不复制旧模块为本轮新增功能", async () => {
    const f = await scene(); const released = await publish(f);
    const next = await saveProjectIteration(f.owner.id, f.project.id, { version: "v1.1", title: "完善协作", baseIterationId: released.id });
    expect(next.features).toEqual([]); expect(next.baseIterationId).toBe(released.id);
    const other = await createProject(f.owner.id, f.team.id, { name: "其他项目" });
    await expect(saveProjectIteration(f.owner.id, other.id, { ...input, baseIterationId: released.id })).rejects.toThrow("当前项目已发布");
    await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, version: "v2", baseIterationId: next.id })).rejects.toThrow("已发布");
  });
  it("版本号在项目内唯一，编辑冲突和跨项目写入都会被拒绝", async () => {
    const f = await scene(); const created = await saveProjectIteration(f.owner.id, f.project.id, input);
    await expect(saveProjectIteration(f.owner.id, f.project.id, { ...input, version: "V1.0.0" })).rejects.toThrow("相同版本号");
    const edit = { id: created.id, updatedAt: created.updatedAt.toISOString() };
    await saveProjectIteration(f.owner.id, f.project.id, { ...input, goal: "调整目标" }, edit);
    await expect(saveProjectIteration(f.owner.id, f.project.id, input, edit)).rejects.toThrow("已被更新");
    const other = await createProject(f.owner.id, f.team.id, { name: "其他项目" });
    await expect(saveProjectIteration(f.owner.id, other.id, input, edit)).rejects.toThrow();
  });
  it("发布必须已有验证结果与发布说明，历史功能和说明随后保持不变", async () => {
    const f = await scene(); const active = await start(f);
    await expect(changeIterationStatus(f.owner.id, f.project.id, active.id, "release", active.updatedAt.toISOString())).rejects.toThrow("验证结果和版本说明");
    const saved = await saveIterationExecution(f.owner.id, f.project.id, active.id, active.updatedAt.toISOString(), execution);
    const released = await changeIterationStatus(f.owner.id, f.project.id, saved.id, "release", saved.updatedAt.toISOString());
    await expect(saveProjectIteration(f.owner.id, f.project.id, input, { id: released.id, updatedAt: released.updatedAt.toISOString() })).rejects.toThrow("已归档");
    await expect(saveIterationExecution(f.owner.id, f.project.id, released.id, released.updatedAt.toISOString(), execution)).rejects.toThrow("已归档");
    const [row] = await listProjectIterations(f.member.id, f.project.id);
    expect(row).toMatchObject({ status: "released", ...execution, features: [expect.objectContaining(input.features[0])] });
  });
  it("推进记录仅在开始后可写，拒绝脚本链接和过期提交", async () => {
    const f = await scene(); const draft = await saveProjectIteration(f.owner.id, f.project.id, input);
    await expect(saveIterationExecution(f.owner.id, f.project.id, draft.id, draft.updatedAt.toISOString(), execution)).rejects.toThrow("先开始");
    const active = await changeIterationStatus(f.owner.id, f.project.id, draft.id, "start", draft.updatedAt.toISOString());
    await expect(saveIterationExecution(f.owner.id, f.project.id, active.id, active.updatedAt.toISOString(), { ...execution, releaseUrl: "javascript:alert(1)" })).rejects.toThrow();
    await saveIterationExecution(f.owner.id, f.project.id, active.id, active.updatedAt.toISOString(), execution);
    await expect(saveIterationExecution(f.owner.id, f.project.id, active.id, active.updatedAt.toISOString(), execution)).rejects.toThrow("已被更新");
  });
  it("并发开始只记录一次，服务端校验登录及代理视角", async () => {
    const f = await scene(); const created = await saveProjectIteration(f.owner.id, f.project.id, input);
    const results = await Promise.allSettled([1, 2].map(() => changeIterationStatus(f.owner.id, f.project.id, created.id, "start", created.updatedAt.toISOString())));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const form = new FormData(); form.set("projectId", f.project.id); form.set("version", "v2"); form.set("title", "下一版"); form.set("features", JSON.stringify(input.features));
    expect(await saveIterationAction(form)).toEqual({ error: "请先登录" });
    request.userId = f.owner.id; request.view = `student:${f.member.id}`;
    expect(await saveIterationAction(form)).toMatchObject({ error: expect.stringContaining("组长") });
    request.view = "admin";
    expect(await saveIterationAction(form)).toEqual({ ok: true });
    request.userId = f.member.id;
    expect(await changeIterationStatusAction({ projectId: f.project.id, iterationId: created.id, updatedAt: created.updatedAt.toISOString(), action: "start" })).toMatchObject({ error: expect.stringContaining("组长") });
  });
  it("推进表单的保存操作保留模块范围并拒绝越权字段", async () => {
    const f = await scene(); const active = await start(f); request.userId = f.owner.id;
    const form = new FormData(); for (const [key, value] of Object.entries({ projectId: f.project.id, iterationId: active.id, updatedAt: active.updatedAt.toISOString(), ...execution, status: "released", features: "[]" })) form.set(key, value);
    expect(await saveIterationExecutionAction(form)).toEqual({ ok: true });
    const [row] = await listProjectIterations(f.owner.id, f.project.id);
    expect(row).toMatchObject({ status: "active", ...execution }); expect(row.features).toHaveLength(1);
  });
});
