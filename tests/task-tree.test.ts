import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { createProject } from "@/lib/project";
import { claimTask, createTask, submitTask } from "@/lib/task";
import {
  generateTaskTreeDraft,
  getTaskTree,
  publishTaskTreeDraft,
  reviewStageIntegration,
  submitStageIntegration,
  submitTaskDelivery,
  updateTaskTreeDraft,
} from "@/lib/task-tree";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ email: "owner@tree.test", password: "password123", name: "组长" });
  const teacher = await createUser({ email: "teacher@tree.test", password: "password123", name: "教师" });
  const team = await createTeam(owner.id, "任务树团队");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "持续迭代项目" });
  return { owner, teacher, project, team };
}

function treeModel(ownerId: string) {
  const payload = {
    summary: "先完成基础，再进行联调",
    stages: [
      { title: "基础", tasks: [{ key: "base", parentKey: null, title: "搭建基础", description: "完成基础能力", assigneeId: ownerId, priority: "high", doneCriteria: ["基础检查通过"] }] },
      { title: "联调", tasks: [{ key: "test", parentKey: null, title: "完成联调", description: "验证整体链路", assigneeId: ownerId, priority: "medium", doneCriteria: ["联调通过"] }] },
    ],
  };
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      content: [{ type: "text", text: JSON.stringify(payload) }],
      warnings: [],
    }),
  });
}

describe("AI 任务树与阶段门禁", () => {
  beforeEach(resetDb);

  it("草案不直接建任务；发布后仅首阶段解锁，集成审核通过后解锁下一阶段", async () => {
    const { owner, teacher, project } = await scene();
    const generated = await generateTaskTreeDraft(owner.id, project.id, "先搭好项目基础，然后进行完整联调测试。", treeModel(owner.id));
    expect((await db.select().from(tasks).where(eq(tasks.projectId, project.id)))).toHaveLength(0);

    await publishTaskTreeDraft(owner.id, generated.draft.id);
    let tree = await getTaskTree(owner.id, project.id);
    expect(tree.stages.map((stage) => stage.status)).toEqual(["active", "locked"]);
    expect(tree.tasks).toHaveLength(2);

    const first = tree.tasks.find((task) => task.stageId === tree.stages[0].id)!;
    const second = tree.tasks.find((task) => task.stageId === tree.stages[1].id)!;
    await expect(claimTask(owner.id, second.id, { commitmentNote: "提前开始" })).rejects.toThrow("尚未解锁");
    await expect(submitStageIntegration(owner.id, tree.stages[0].id, { branchName: "integration/base" })).rejects.toThrow("未通过验收");

    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, first.id));
    await expect(submitStageIntegration(owner.id, tree.stages[0].id, { branchName: "integration/base" })).rejects.toThrow("未登记交付分支");
    await submitTaskDelivery(owner.id, first.id, { branchName: "task/base", headSha: "abc123" });
    const integration = await submitStageIntegration(owner.id, tree.stages[0].id, { branchName: "integration/base", headSha: "def456" });
    await expect(reviewStageIntegration(owner.id, integration.id, { decision: "accept" })).rejects.toThrow("不能审核自己");
    await reviewStageIntegration(teacher.id, integration.id, { decision: "accept", note: "集成测试通过" });

    tree = await getTaskTree(owner.id, project.id);
    expect(tree.stages.map((stage) => stage.status)).toEqual(["completed", "active"]);
  });

  it("导师不能通过底层函数认领、提交或登记交付，即使任务被指派给导师", async () => {
    const { owner, teacher, project } = await scene();
    const task = await createTask(owner.id, project.id, { title: "导师不能执行", assigneeId: teacher.id });
    await expect(claimTask(teacher.id, task.id, { commitmentNote: "认领" })).rejects.toThrow("没有权限");
    await expect(submitTask(teacher.id, task.id, { completionNote: "提交" })).rejects.toThrow("不能执行任务");
    const generated = await generateTaskTreeDraft(owner.id, project.id, "搭建基础并交付验收材料。", treeModel(owner.id));
    await publishTaskTreeDraft(owner.id, generated.draft.id);
    const tree = await getTaskTree(owner.id, project.id);
    const stageTask = tree.tasks.find((item) => item.stageId === tree.stages[0].id)!;
    await db.update(tasks).set({ assigneeId: teacher.id }).where(eq(tasks.id, stageTask.id));
    await expect(submitTaskDelivery(teacher.id, stageTask.id, { branchName: "teacher/work" })).rejects.toThrow("不能登记");
  });

  it("草案修改校验权限、成员和层级；发布使用保存后的内容，不能再次修改", async () => {
    const { owner, teacher, project } = await scene();
    const generated = await generateTaskTreeDraft(owner.id, project.id, "先搭好项目基础，然后进行完整联调测试。", treeModel(owner.id));
    const edited = structuredClone(generated.draft.payload);
    edited.stages[0].tasks[0].title = "人工修订后的任务";
    await expect(updateTaskTreeDraft(teacher.id, generated.draft.id, edited)).rejects.toThrow("只有项目负责人");
    const outsider = await createUser({ email: "outside@tree.test", password: "password123", name: "非成员" });
    const invalidMember = structuredClone(edited);
    invalidMember.stages[0].tasks[0].assigneeId = outsider.id;
    await expect(updateTaskTreeDraft(owner.id, generated.draft.id, invalidMember)).rejects.toThrow("负责人不是团队成员");
    invalidMember.stages[0].tasks[0].assigneeId = teacher.id;
    await expect(updateTaskTreeDraft(owner.id, generated.draft.id, invalidMember)).rejects.toThrow("或为导师");
    const invalidParent = structuredClone(edited);
    invalidParent.stages[0].tasks[0].parentKey = "missing";
    await expect(updateTaskTreeDraft(owner.id, generated.draft.id, invalidParent)).rejects.toThrow("父任务必须先出现");
    await updateTaskTreeDraft(owner.id, generated.draft.id, edited);
    expect((await getTaskTree(owner.id, project.id)).tasks).toHaveLength(0);
    await publishTaskTreeDraft(owner.id, generated.draft.id);
    expect((await getTaskTree(owner.id, project.id)).tasks.some((task) => task.title === "人工修订后的任务")).toBe(true);
    await expect(updateTaskTreeDraft(owner.id, generated.draft.id, edited)).rejects.toThrow("已经处理");
  });

  it("普通组员不能发起阶段集成，新增需求追加阶段而不覆盖已有任务", async () => {
    const { owner, project, team } = await scene();
    const member = await createUser({ email: "member@tree.test", password: "password123", name: "组员" });
    await joinTeam(member.id, team.inviteCode);
    const generated = await generateTaskTreeDraft(owner.id, project.id, "先搭好项目基础，然后进行完整联调测试。", treeModel(owner.id));
    await publishTaskTreeDraft(owner.id, generated.draft.id);
    const before = await getTaskTree(owner.id, project.id);
    await expect(submitStageIntegration(member.id, before.stages[0].id, { branchName: "integration/member" })).rejects.toThrow("只有项目负责人");
    const next = await generateTaskTreeDraft(owner.id, project.id, "补充下一轮需求并保留原有成果。", treeModel(owner.id));
    await publishTaskTreeDraft(owner.id, next.draft.id);
    const after = await getTaskTree(owner.id, project.id);
    expect(after.stages.map((stage) => stage.position)).toEqual([1, 2, 3, 4]);
    expect(after.stages.map((stage) => stage.status)).toEqual(["active", "locked", "locked", "locked"]);
    for (const original of before.tasks) expect(after.tasks.some((task) => task.id === original.id)).toBe(true);
  });
});
