import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectBriefs, taskTreeDrafts, tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { adviseDraftPlanning } from "@/lib/draft-planning-ai";
import { emptyDraftPlan } from "@/lib/draft-planning";
import type { TaskTreePayload } from "@/lib/task-tree";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ email: "owner@planning.test", password: "password123", name: "组长" });
  const member = await createUser({ email: "member@planning.test", password: "password123", name: "组员" });
  const team = await createTeam(owner.id, "规划测试");
  await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "预约平台" });
  const payload: TaskTreePayload = { summary: "设计和开发可以并行", stages: [{ title: "开发", tasks: ["a", "b", "c"].map(key => ({ key, parentKey: null, title: key, description: "", assigneeId: null, priority: "medium", doneCriteria: ["结果可检查"] })) }] };
  const [brief] = await db.insert(projectBriefs).values({ projectId: project.id, createdById: owner.id, content: "让同学预约实验室，禁止重复预约同一时段。" }).returning();
  const [draft] = await db.insert(taskTreeDrafts).values({ projectId: project.id, briefId: brief.id, createdById: owner.id, payload }).returning();
  return { owner, member, project, draft, payload };
}

function modelFor(results: unknown[], prompts: string[] = []) {
  let index = 0;
  return new MockLanguageModelV2({ doGenerate: async options => {
    prompts.push(JSON.stringify(options.prompt));
    return { finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, content: [{ type: "text", text: JSON.stringify(results[index++]) }], warnings: [] };
  } });
}

describe("AI 草案建议只读边界", () => {
  beforeEach(resetDb);
  it("独立进行两轮分析，采用复核结果且不写入草案或任务", async () => {
    const s = await scene();
    const first = emptyDraftPlan(s.payload);
    first.stages[0].links[1].afterKeys = ["a"];
    first.stages[0].links[2].afterKeys = ["b"];
    const final = structuredClone(first);
    final.stages[0].links[2].afterKeys = ["a"];
    final.reviewNote = "b 与 c 可以并行，已纠正人为串行。";
    const prompts: string[] = [];
    const result = await adviseDraftPlanning(s.owner.id, { mode: "plan", projectId: s.project.id, draftId: s.draft.id, payload: s.payload }, modelFor([first, final], prompts));
    expect(result.plan?.stages[0].links[2].afterKeys).toEqual(["a"]);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("禁止重复预约");
    expect(prompts[1]).toContain("重新逐条审核");
    const [stored] = await db.select().from(taskTreeDrafts).where(eq(taskTreeDrafts.id, s.draft.id));
    expect(stored.payload).toEqual(s.payload);
    expect(stored.status).toBe("pending");
    expect(await db.select().from(tasks).where(eq(tasks.projectId, s.project.id))).toHaveLength(0);
  });
  it("不适合的新增任务如实返回理由和标准，拒绝无效前置", async () => {
    const s = await scene();
    const input = { mode: "refine" as const, projectId: s.project.id, draftId: s.draft.id, payload: s.payload, stageIndex: 0, title: "开发小游戏", afterKeys: ["a"] };
    const suggestion = { fit: "unsuitable", reason: "与实验室预约目标无关", afterKeys: [], title: "验证重复预约", description: "核对同一时段预约冲突", doneCriteria: ["第二次预约被拒绝且提示冲突"] };
    const result = await adviseDraftPlanning(s.owner.id, input, modelFor([suggestion]));
    expect(result.suggestion?.fit).toBe("unsuitable");
    expect(result.suggestion?.doneCriteria).toEqual(suggestion.doneCriteria);
    await expect(adviseDraftPlanning(s.owner.id, input, modelFor([{ ...suggestion, afterKeys: ["missing"] }]))).rejects.toThrow("无效前置");
  });
  it("组员不能调用组长的规划模型，复核后形成循环也不能采用", async () => {
    const s = await scene();
    const input = { mode: "plan" as const, projectId: s.project.id, draftId: s.draft.id, payload: s.payload };
    await expect(adviseDraftPlanning(s.member.id, input, modelFor([]))).rejects.toThrow();
    const first = emptyDraftPlan(s.payload);
    const cyclic = structuredClone(first);
    cyclic.stages[0].links[0].afterKeys = ["b"];
    cyclic.stages[0].links[1].afterKeys = ["a"];
    await expect(adviseDraftPlanning(s.owner.id, input, modelFor([first, cyclic]))).rejects.toThrow("循环");
  });
});
