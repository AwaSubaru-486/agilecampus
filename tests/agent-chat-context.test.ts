import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { createConversation, forkConversation, listConversationMessages, listRecentConversationMessages, persistTurn, updateConversation } from "@/lib/agent/conversation";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { createContextPack } from "@/lib/context-pack";
import { assertChatNotAborted, buildChatHistory, CHAT_HISTORY_CHAR_LIMIT, ChatTimeoutError } from "@/lib/agent/chat-context";
import { resetDb } from "./helpers";
import { buildTools } from "@/lib/agent/tools";
import { db } from "@/db";
import { messages } from "@/db/schema";

async function scene() {
  const owner = await createUser({ name: "owner", email: "owner@chat.test", password: "password123" });
  const member = await createUser({ name: "member", email: "member@chat.test", password: "password123" });
  const team = await createTeam(owner.id, "汪汪队"); await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "敏捷开发平台" });
  return { owner, member, team, project };
}
function textModel(inspect?: (prompt: string) => void) {
  return new MockLanguageModelV2({ doGenerate: async opts => {
    inspect?.(JSON.stringify(opts.prompt));
    return { finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, content: [{ type: "text", text: "请按完成条件交付成果。" }], warnings: [] };
  } });
}

describe("AI 会话上下文与失败处理", () => {
  beforeEach(resetDb);
  it("自动带入会话关联任务的完成条件，并续接最近人机消息", async () => {
    const s = await scene();
    const task = await createTask(s.owner.id, s.project.id, { title: "确认验收标准", doneCriteria: ["至少覆盖两种异常输入"] });
    const conversation = await createConversation(s.owner.id, s.project.id, { taskId: task.id });
    await persistTurn(conversation.id, "之前讨论错误提示", "需要明确字段错误", [], s.owner.id);
    let prompt = "";
    await runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, conversationId: conversation.id, userText: "接下来怎么做", model: textModel(value => { prompt = value; }) });
    expect(prompt).toContain("当前会话关联任务"); expect(prompt).toContain("至少覆盖两种异常输入");
    expect(prompt).toContain("之前讨论错误提示"); expect(prompt).toContain("需要明确字段错误");
    expect(await listConversationMessages(s.owner.id, conversation.id)).toHaveLength(4);
  });
  it("长历史按预算截取，保留最新消息并标出裁剪，不包含工具消息", () => {
    const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message-${index}` + "中".repeat(5_000) }));
    history.push({ role: "tool", content: "secret-tool-output" }, { role: "user", content: "latest-question" });
    const bounded = buildChatHistory(history);
    expect(bounded.at(-1)?.content).toBe("latest-question");
    expect(bounded.reduce((total, item) => total + item.content.length, 0)).toBeLessThanOrEqual(CHAT_HISTORY_CHAR_LIMIT);
    expect(JSON.stringify(bounded)).not.toContain("secret-tool-output");
    expect(buildChatHistory([{ role: "assistant", content: "头".repeat(12_000) + "末尾结论" }])[0].content).toContain("已裁剪");
  });
  it("AI 在数据库中只读取近期尾部，界面仍可获取全部历史", async () => {
    const s = await scene(); const conversation = await createConversation(s.owner.id, s.project.id);
    await db.insert(messages).values(Array.from({ length: 60 }, (_, index) => ({ conversationId: conversation.id, role: index % 2 ? "assistant" as const : "user" as const, content: `history-${index}`, createdAt: new Date(1_700_000_000_000 + index) })));
    const tail = await listRecentConversationMessages(s.owner.id, conversation.id);
    expect(tail).toHaveLength(41); expect(tail[0].content).toBe("history-19"); expect(tail.at(-1)?.content).toBe("history-59");
    expect(await listConversationMessages(s.owner.id, conversation.id)).toHaveLength(60);
  });
  it("跨项目上下文在请求模型前被拒绝", async () => {
    const s = await scene(); const other = await createProject(s.owner.id, s.team.id, { name: "另一个" });
    const pack = await createContextPack(s.owner.id, other.id, { title: "其他项目", status: "frozen", sources: [{ sourceType: "manual", snapshot: { text: "不应发送" } }] });
    let called = false;
    await expect(runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, contextPackId: pack.pack.id, userText: "看资料", model: textModel(() => { called = true; }) })).rejects.toThrow("当前项目");
    expect(called).toBe(false);
  });
  it("含私人消息的快照只能用于私人对话，私人分支默认继续保持私人", async () => {
    const s = await scene(); const privateConversation = await createConversation(s.owner.id, s.project.id, { visibility: "private" });
    const turn = await persistTurn(privateConversation.id, "个人草稿", "私密回复", [], s.owner.id);
    const fork = await forkConversation(s.owner.id, privateConversation.id, turn.assistantMessage!.id);
    expect(fork.visibility).toBe("private");
    await expect(listConversationMessages(s.member.id, fork.id)).rejects.toThrow("没有权限");
    const pack = await createContextPack(s.owner.id, s.project.id, { title: "私人素材", status: "frozen", sources: [{ sourceType: "message", sourceId: turn.assistantMessage!.id }] });
    const shared = await createConversation(s.owner.id, s.project.id);
    await expect(runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, conversationId: shared.id, contextPackId: pack.pack.id, userText: "分析", model: textModel() })).rejects.toThrow("私人会话");
    await runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, conversationId: fork.id, contextPackId: pack.pack.id, userText: "分析", model: textModel() });
    expect(await listConversationMessages(s.owner.id, shared.id)).toHaveLength(0);
  });
  it("来源更新后的冻结快照会说明历史性质，不替换为新内容", async () => {
    const s = await scene(); const task = await createTask(s.owner.id, s.project.id, { title: "原始目标" });
    const pack = await createContextPack(s.owner.id, s.project.id, { title: "历史", status: "frozen", sources: [{ sourceType: "task", sourceId: task.id }] });
    const { updateTask } = await import("@/lib/task"); await updateTask(s.owner.id, task.id, { title: "修订目标" });
    let prompt = "";
    await runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, userText: "对照历史", contextPackId: pack.pack.id, model: textModel(value => { prompt = value; }) });
    expect(prompt).toContain("来源已更新"); expect(prompt).toContain("原始目标"); expect(prompt).toContain("修订目标");
  });
  it("取消和空回复不会存入半轮消息，超时与取消有明确错误", async () => {
    const s = await scene(); const conversation = await createConversation(s.owner.id, s.project.id);
    const controller = new AbortController();
    await expect(runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, conversationId: conversation.id, userText: "分析", abortSignal: controller.signal, model: textModel(() => controller.abort()) })).rejects.toThrow("已取消");
    const empty = new MockLanguageModelV2({ doGenerate: async () => ({ finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, content: [], warnings: [] }) });
    await expect(runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, conversationId: conversation.id, userText: "分析", model: empty })).rejects.toThrow("有效回复");
    expect(await listConversationMessages(s.owner.id, conversation.id)).toHaveLength(0);
    const timeout = new AbortController(); timeout.abort(new DOMException("timeout", "TimeoutError"));
    expect(() => assertChatNotAborted(timeout.signal)).toThrow(ChatTimeoutError);
  });
  it("模型只返回任务草案而无正文时仍给出可确认的回复", async () => {
    const s = await scene();
    let call = 0;
    const model = new MockLanguageModelV2({ doGenerate: async () => ({ finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, content: call++ === 0 ? [{ type: "tool-call", toolCallId: "draft", toolName: "decompose_tasks", input: JSON.stringify({ tasks: [{ title: "检查异常输入" }] }) }] : [], warnings: [] }) });
    const result = await runAgentTurn({ actorId: s.owner.id, projectId: s.project.id, userText: "拟一项验证任务", model });
    expect(result.text).toBe("已拟好草案，请确认后生效。");
    expect(result.drafts[0].approvalId).toBeTruthy();
    const proposals = await buildTools(s.owner.id, s.project.id, result.conversationId).list_proposals.execute!({}, {} as never);
    expect(proposals).toEqual([expect.objectContaining({ status: "pending", tool: "decompose_tasks" })]);
  });
  it("共享会话的并发回复保持完整轮次顺序，保存时拒绝可见范围变化", async () => {
    const s = await scene(); const conversation = await createConversation(s.owner.id, s.project.id);
    await Promise.all([persistTurn(conversation.id, "问题一", "回答一", [], s.owner.id), persistTurn(conversation.id, "问题二", "回答二", [], s.member.id)]);
    const history = await listConversationMessages(s.owner.id, conversation.id);
    expect(history.map(message => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(new Set(history.map(message => message.createdAt.getTime())).size).toBe(4);
    await updateConversation(s.owner.id, conversation.id, { visibility: "private" });
    await expect(persistTurn(conversation.id, "新问题", "新回答", [], s.owner.id, undefined, "project")).rejects.toThrow("可见范围");
    expect(await listConversationMessages(s.owner.id, conversation.id)).toHaveLength(4);
  });
});
