import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { createProject } from "@/lib/project";
import { claimTask } from "@/lib/task";
import {
  generateTaskTreeDraft,
  getTaskTree,
  publishTaskTreeDraft,
  reviewStageIntegration,
  submitStageIntegration,
  submitTaskDelivery,
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
  return { owner, teacher, project };
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
});
