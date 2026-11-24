import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { type ContextPackView } from "@/lib/context-pack";
import { AppError, ForbiddenError } from "@/lib/errors";
import { getConversationForUser } from "./conversation";

export const MAX_CHAT_INPUT_CHARS = 20_000;
export const CHAT_HISTORY_CHAR_LIMIT = 24_000;
export const CHAT_TIMEOUT_MS = 90_000;
export class ChatTimeoutError extends AppError {}
export class ChatCanceledError extends AppError {}
export function assertChatNotAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  if (signal.reason?.name === "TimeoutError") throw new ChatTimeoutError("AI 响应超时，请稍后重试");
  throw new ChatCanceledError("本次对话已取消，可重新发送");
}

/** Keep recent context within a fixed budget, without pretending a clipped message is complete. */
export function buildChatHistory(history: { role: string; content: string }[]) {
  const selected: { role: "user" | "assistant"; content: string }[] = [];
  let used = 0;
  for (const message of history.filter(item => item.role === "user" || item.role === "assistant").slice(-40).reverse()) {
    const content = message.content.length > 8_000
      ? `${message.content.slice(0, 4_000)}\n[此条历史消息中段已裁剪]\n${message.content.slice(-3_900)}` : message.content;
    if (used + content.length > CHAT_HISTORY_CHAR_LIMIT) break;
    selected.unshift({ role: message.role as "user" | "assistant", content });
    used += content.length;
  }
  return selected;
}

export async function assertChatContext(actorId: string, projectId: string, visibility: "private" | "project", view: ContextPackView) {
  if (view.pack.projectId !== projectId) throw new ForbiddenError("上下文包不属于当前项目");
  if (view.pack.status !== "frozen") throw new AppError("只有冻结后的上下文包可以交给模型");
  if (visibility === "private") return;
  const included = view.items.filter(item => item.included);
  const sourceConversations = new Set(included.filter(item => item.sourceType === "conversation" && item.sourceId).map(item => item.sourceId!));
  if (view.pack.conversationId) sourceConversations.add(view.pack.conversationId);
  const sourceMessages = included.filter(item => item.sourceType === "message" && item.sourceId).map(item => item.sourceId!);
  if (sourceMessages.length) {
    const rows = await db.select({ id: messages.id, conversationId: messages.conversationId }).from(messages).where(inArray(messages.id, sourceMessages));
    if (rows.length !== new Set(sourceMessages).size) throw new AppError("上下文消息来源已变更，请更新快照后再共享");
    rows.forEach(row => sourceConversations.add(row.conversationId));
  }
  const sources = await Promise.all([...sourceConversations].map(id => getConversationForUser(actorId, id)));
  if (sources.some(source => source.visibility === "private")) throw new AppError("含私人会话资料的上下文包请在私人会话中使用");
}

export async function assertConversationStillWritable(actorId: string, conversationId: string, expectedVisibility: "private" | "project") {
  const conversation = await getConversationForUser(actorId, conversationId);
  if (conversation.visibility !== expectedVisibility) throw new AppError("会话可见范围已改变，请重新发送");
  return conversation;
}
