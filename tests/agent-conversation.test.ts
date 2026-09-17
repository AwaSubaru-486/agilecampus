import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  createConversation,
  forkConversation,
  getOrCreateConversation,
  listProjectConversations,
  persistTurn,
  listConversationMessages,
} from "@/lib/agent/conversation";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

describe("getOrCreateConversation", () => {
  beforeEach(resetDb);

  it("首次创建，二次复用同一会话", async () => {
    const { student, project } = await scene();
    const c1 = await getOrCreateConversation(student.id, project.id);
    const c2 = await getOrCreateConversation(student.id, project.id);
    expect(c1.id).toBe(c2.id);
  });

  it("非成员被拒", async () => {
    const { outsider, project } = await scene();
    await expect(getOrCreateConversation(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});

describe("persistTurn / listConversationMessages", () => {
  beforeEach(resetDb);

  it("落一轮 user+assistant 消息，assistant 携工具轨迹", async () => {
    const { student, project } = await scene();
    const conv = await getOrCreateConversation(student.id, project.id);
    await persistTurn(conv.id, "项目进度如何？", "共有 2 个任务。", [
      { toolName: "query_progress", input: {}, output: { taskTotal: 2 } },
    ]);

    const msgs = await listConversationMessages(student.id, conv.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("项目进度如何？");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("共有 2 个任务。");
    expect(msgs[1].toolCalls).toEqual([
      { toolName: "query_progress", input: {}, output: { taskTotal: 2 } },
    ]);
  });

  it("listConversationMessages 非成员被拒", async () => {
    const { student, outsider, project } = await scene();
    const conv = await getOrCreateConversation(student.id, project.id);
    await expect(listConversationMessages(outsider.id, conv.id)).rejects.toThrow("没有权限");
  });
});

describe("项目共享会话与上下文分支", () => {
  beforeEach(resetDb);

  it("项目共享会话对队友可见，私人会话仅创建者可见", async () => {
    const { owner, student, project } = await scene();
    await createConversation(student.id, project.id, {
      title: "共享调研讨论",
      visibility: "project",
    });
    await createConversation(student.id, project.id, {
      title: "个人草稿",
      visibility: "private",
    });

    const mine = await listProjectConversations(student.id, project.id);
    const teammateView = await listProjectConversations(owner.id, project.id);
    expect(mine.map((item) => item.title)).toEqual(
      expect.arrayContaining(["共享调研讨论", "个人草稿"]),
    );
    expect(teammateView.map((item) => item.title)).toContain("共享调研讨论");
    expect(teammateView.map((item) => item.title)).not.toContain("个人草稿");
  });

  it("从指定 AI 回复创建分支，只继承该回复及此前消息并保留来源", async () => {
    const { student, project } = await scene();
    const source = await createConversation(student.id, project.id, { title: "原方案" });
    const first = await persistTurn(source.id, "先分析目标", "目标分析完成", [], student.id);
    await persistTurn(source.id, "再给出计划", "计划生成完成", [], student.id);

    const fork = await forkConversation(
      student.id,
      source.id,
      first.assistantMessage!.id,
      { title: "备选方案" },
    );
    const inherited = await listConversationMessages(student.id, fork.id);

    expect(fork.parentConversationId).toBe(source.id);
    expect(fork.forkedFromMessageId).toBe(first.assistantMessage!.id);
    expect(inherited).toHaveLength(2);
    expect(inherited.map((item) => item.content)).toEqual(["先分析目标", "目标分析完成"]);
    expect(inherited.every((item) => item.sourceMessageId)).toBe(true);
  });
});
