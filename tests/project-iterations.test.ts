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
import { claimTask, createTask, reviewTask, submitTask } from "@/lib/task";
import { submitTaskWithDelivery } from "@/lib/task-submission";
import { createEvidenceItem } from "@/lib/evidence";
import { recheckCompletedTask } from "@/lib/task-recheck";
import { changeIterationStatus, getProjectIterationWorkspace, listProjectIterations, saveProjectIteration, saveIterationExecution, continueIteration, saveIterationWorkspace } from "@/lib/project-iterations";
import { changeIterationStatusAction, saveIterationAction, saveIterationExecutionAction, continueIterationAction, saveWorkspaceAction } from "@/app/(app)/projects/[projectId]/iterations/actions";
import { iterationModules } from "@/lib/iteration-modules";
import { randomUUID } from "node:crypto";
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

describe("自动同步已验收的交付成果", () => {
  it("从项目已验收的交付读取说明和 PR，待验收和退回的交付不进入迭代", async () => {
    const f = await scene();
    await claimTask(f.member.id, f.task.id, { commitmentNote: "接入搜索" });
    await submitTaskWithDelivery(f.member.id, f.task.id, {
      branchName: "feature/search", pullRequestUrl: "https://example.com/pull/1", completionNote: "可以按名称搜索活动。",
      handoffVersion: f.task.handoffVersion, evidence: {},
    });
    const rejected = await createTask(f.owner.id, f.project.id, { title: "待修改内容", assigneeId: f.member.id });
    await claimTask(f.member.id, rejected.id, { commitmentNote: "调整筛选" });
    await submitTask(f.member.id, rejected.id, { completionNote: "筛选仍需修改" });
    await reviewTask(f.owner.id, rejected.id, { decision: "reject", note: "缺少筛选条件" });
    expect(await getProjectIterationWorkspace(f.member.id, f.project.id)).toEqual({ iterations: [], outcomes: [] });

    const accepted = await reviewTask(f.owner.id, f.task.id, { decision: "accept" });
    const outcome = { taskId: f.task.id, title: f.task.title, summary: "可以按名称搜索活动。", resultUrl: "https://example.com/pull/1",
      submittedAt: accepted.submittedAt!.toISOString(), acceptedAt: accepted.reviewedAt!.toISOString() };
    expect(await getProjectIterationWorkspace(f.member.id, f.project.id)).toEqual({ iterations: [], outcomes: [outcome] });
    await recheckCompletedTask(f.teacher.id, f.project.id, f.task.id, { decision: "accept" });
    expect((await getProjectIterationWorkspace(f.teacher.id, f.project.id)).outcomes).toEqual([outcome]);
    const other = await createProject(f.owner.id, f.team.id, { name: "其他项目" });
    expect((await getProjectIterationWorkspace(f.member.id, other.id)).outcomes).toEqual([]);
    await expect(getProjectIterationWorkspace(f.outsider.id, f.project.id)).rejects.toThrow();
  });

  it("可仅凭同步成果保存版本，保持历史快照且并发发布只归档一次", async () => {
    const f = await scene();
    await claimTask(f.member.id, f.task.id, { commitmentNote: "制作演示" });
    await createEvidenceItem(f.member.id, f.task.id, { type: "demo", label: "演示", value: "https://example.com/demo" });
    await submitTask(f.member.id, f.task.id, { completionNote: "原始验收成果" });
    await reviewTask(f.owner.id, f.task.id, { decision: "accept" });
    const legacy = await publish({ ...f, project: await createProject(f.owner.id, f.team.id, { name: "已有版本演示" }) });
    const first = await continueIteration(f.owner.id, f.project.id, null);
    const second = await saveProjectIteration(f.owner.id, f.project.id, { version: "v2", title: "另一份开发版本" });
    const results = await Promise.allSettled([first, second].map(row => saveIterationWorkspace(f.owner.id, f.project.id, row.id,
      row.updatedAt.toISOString(), { version: row.version, title: row.title, modules: [], publish: true })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ message: expect.stringContaining("没有待归档") }) })]);
    await db.update(tasks).set({ title: "后续更名" }).where(eq(tasks.id, f.task.id));
    await recheckCompletedTask(f.teacher.id, f.project.id, f.task.id, { decision: "accept" });
    const workspace = await getProjectIterationWorkspace(f.member.id, f.project.id);
    expect(workspace.outcomes).toEqual([]);
    const released = workspace.iterations.find(row => row.status === "released");
    expect(released).toMatchObject({ features: [], outcomeSnapshot: [{ taskId: f.task.id, title: f.task.title, summary: "原始验收成果", resultUrl: "https://example.com/demo" }] });
    expect(legacy.outcomeSnapshot).toEqual([]);
  });
});

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


describe("在完整模块快照上继续开发", () => {
  it("继承旧模块身份；只把实际变化加入演进图；下一轮继承成果与断点", async () => {
    const f = await scene(); const first = await publish(f);
    const next = await continueIteration(f.owner.id, f.project.id, first.id);
    expect(next.features).toEqual([]);
    expect(next.moduleSnapshot).toHaveLength(1);
    const original = next.moduleSnapshot![0];
    const capability = { ...original, summary: "成员可以共享资料，并搜索历史成果。", resultUrl: "https://example.com/demo", context: "保留共享权限；下一步检查搜索体验。" };
    const beforeTasks = await db.select().from(tasks);
    const saved = await saveIterationWorkspace(f.owner.id, f.project.id, next.id, next.updatedAt.toISOString(), { version: next.version, title: "共享能力更完整", modules: [capability], executionNotes: "继续检查窄屏体验", publish: true });
    expect(saved.features).toEqual([expect.objectContaining({ id: original.id, change: "improved" })]);
    expect(saved.validationNotes).toBe("");
    const third = await continueIteration(f.owner.id, f.project.id, saved.id);
    expect(third.moduleSnapshot).toEqual([capability]);
    expect(third.executionNotes).toBe("继续检查窄屏体验");
    expect(third.features).toEqual([]);
    expect(await db.select().from(tasks)).toEqual(beforeTasks);
    expect(await db.select().from(iterationTasks)).toEqual([]);
    await expect(saveIterationWorkspace(f.owner.id, f.project.id, saved.id, saved.updatedAt.toISOString(), { version: saved.version, title: saved.title, modules: [] })).rejects.toThrow("已归档");
  });
  it("保持未修改模块；改回原样取消本轮差异；备注不伪装成功能交付", async () => {
    const f = await scene(); const first = await publish(f); const next = await continueIteration(f.owner.id, f.project.id, first.id);
    const modules = next.moduleSnapshot!;
    const values = { version: next.version, title: next.title, modules: modules.map(capability => ({ ...capability, context: "尚在探索" })) };
    const saved = await saveIterationWorkspace(f.owner.id, f.project.id, next.id, next.updatedAt.toISOString(), values);
    expect(saved.features).toEqual([]);
    await expect(saveIterationWorkspace(f.owner.id, f.project.id, saved.id, saved.updatedAt.toISOString(), { ...values, publish: true })).rejects.toThrow("尚无功能变化");
    await expect(saveIterationWorkspace(f.owner.id, f.project.id, saved.id, saved.updatedAt.toISOString(), { ...values, modules: [] })).rejects.toThrow("继承的模块");
  });
  it("首轮无需目标与复盘表；新增模块后可直接保存版本", async () => {
    const f = await scene(); const next = await continueIteration(f.owner.id, f.project.id, null);
    const capability = { id: randomUUID(), name: "活动广场", summary: "浏览校园活动。", resultUrl: "", context: "" };
    const saved = await saveIterationWorkspace(f.owner.id, f.project.id, next.id, next.updatedAt.toISOString(), { version: "v0.1.0", title: "看见活动", modules: [capability], publish: true });
    expect(saved.status).toBe("released"); expect(saved.features[0].change).toBe("added");
  });
  it("越权、跨项目基准、不安全链接、并发覆盖都被拒绝", async () => {
    const f = await scene(); const first = await publish(f);
    const other = await createProject(f.owner.id, f.team.id, { name: "其他项目" });
    await expect(continueIteration(f.owner.id, other.id, first.id)).rejects.toThrow("当前项目");
    const next = await continueIteration(f.owner.id, f.project.id, first.id);
    const values = { version: next.version, title: next.title, modules: next.moduleSnapshot! };
    await expect(continueIteration(f.member.id, f.project.id, first.id)).rejects.toThrow("组长");
    await expect(saveIterationWorkspace(f.member.id, f.project.id, next.id, next.updatedAt.toISOString(), values)).rejects.toThrow("组长");
    await expect(saveIterationWorkspace(f.owner.id, f.project.id, next.id, next.updatedAt.toISOString(), { ...values, modules: values.modules.map(capability => ({ ...capability, resultUrl: "javascript:alert(1)" })) })).rejects.toThrow();
    const results = await Promise.allSettled([1, 2].map(() => saveIterationWorkspace(f.owner.id, f.project.id, next.id, next.updatedAt.toISOString(), values)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  });
  it("双击继续开发不会创建两个相同基准工作区，旧版本按模块名接续身份", async () => {
    const f = await scene(); const first = await publish(f);
    const rows = await Promise.all([1, 2].map(() => continueIteration(f.owner.id, f.project.id, first.id)));
    expect(rows[0].id).toBe(rows[1].id);
    const oldNext = await saveProjectIteration(f.owner.id, f.project.id, { ...input, version: "v2", baseIterationId: first.id, features: [{ ...input.features[0], summary: "同一模块继续完善。" }] });
    const views = await listProjectIterations(f.owner.id, f.project.id);
    const modules = iterationModules(views.find(row => row.id === oldNext.id), views);
    expect(modules).toHaveLength(1); expect(modules[0].id).toBe(first.features[0].id);
  });
});


it("新工作区操作沿用登录和代理视角权限", async () => {
  const f = await scene();
  expect(await continueIterationAction({ projectId: f.project.id, baseId: null })).toEqual({ error: "请先登录" });
  request.userId = f.owner.id; request.view = `student:${f.member.id}`;
  expect(await continueIterationAction({ projectId: f.project.id, baseId: null })).toMatchObject({ error: expect.stringContaining("组长") });
  request.view = "admin";
  const result = await continueIterationAction({ projectId: f.project.id, baseId: null });
  expect(result).toHaveProperty("id");
  const [row] = await listProjectIterations(f.owner.id, f.project.id);
  request.view = `student:${f.member.id}`;
  expect(await saveWorkspaceAction({ projectId: f.project.id, iterationId: row.id, updatedAt: row.updatedAt, version: row.version, title: row.title, modules: [] })).toMatchObject({ error: expect.stringContaining("组长") });
});
