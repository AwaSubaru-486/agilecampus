import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatCanceledError, ChatTimeoutError, MAX_CHAT_INPUT_CHARS } from "@/lib/agent/chat-context";
const mock = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@/lib/agent/orchestrator", () => ({ runAgentTurn: mock.run }));
import { POST } from "@/app/api/chat/route";

const projectId = "00000000-0000-4000-8000-000000000001";
const request = (userText = "查看当前阶段") => new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ projectId, userText }), headers: { "Content-Type": "application/json" } });
describe("chat API 兼容现有前端", () => {
  beforeEach(() => { vi.resetAllMocks(); mock.auth.mockResolvedValue({ user: { id: "actor" } }); });
  it("保持原响应字段，同时传递取消信号", async () => {
    mock.run.mockResolvedValue({ conversationId: "conversation", userMessageId: "user", assistantMessageId: "assistant", text: "当前阶段有三项任务", toolTrace: [], drafts: [] });
    const req = request(); const response = await POST(req);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ text: "当前阶段有三项任务", drafts: [] });
    expect(mock.run.mock.calls[0][0].abortSignal).toBe(req.signal);
  });
  it("拒绝过长消息及未登录请求，不启动模型", async () => {
    expect((await POST(request("长".repeat(MAX_CHAT_INPUT_CHARS + 1)))).status).toBe(400);
    mock.auth.mockResolvedValue(null); expect((await POST(request())).status).toBe(401);
    expect(mock.run).not.toHaveBeenCalled();
  });
  it("超时和取消返回可展示错误", async () => {
    mock.run.mockRejectedValueOnce(new ChatTimeoutError("AI 响应超时，请稍后重试"));
    const timeout = await POST(request()); expect(timeout.status).toBe(504); expect(await timeout.json()).toEqual({ error: "AI 响应超时，请稍后重试" });
    mock.run.mockRejectedValueOnce(new ChatCanceledError("本次对话已取消，可重新发送"));
    expect((await POST(request())).status).toBe(408);
  });
});
