import type { ConversationListItem } from "./conversation";

export type ConversationSelection = Pick<ConversationListItem, "id" | "taskId" | "visibility">;

/**
 * Chooses the conversation that should open when a project page is entered.
 * An explicit URL selection always wins; a task deep link then prefers the
 * task's shared session so a handoff resumes the right piece of work.
 */
export function selectConversationForWorkspace<T extends ConversationSelection>(
  conversations: T[],
  options: {
    conversationId?: string | null;
    approvalConversationId?: string | null;
    taskId?: string | null;
  },
): T | null {
  return (
    conversations.find((conversation) => conversation.id === options.conversationId) ??
    conversations.find((conversation) => conversation.id === options.approvalConversationId) ??
    conversations.find(
      (conversation) =>
        conversation.taskId === options.taskId && conversation.visibility === "project",
    ) ??
    conversations[0] ??
    null
  );
}
