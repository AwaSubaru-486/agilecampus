import { describe, expect, it } from "vitest";
import { selectConversationForWorkspace } from "@/lib/agent/conversation-selection";

const conversations = [
  { id: "recent", taskId: "other-task", visibility: "project" as const },
  { id: "task-private", taskId: "task-a", visibility: "private" as const },
  { id: "task-shared", taskId: "task-a", visibility: "project" as const },
];

describe("selectConversationForWorkspace", () => {
  it("prefers the explicitly requested conversation", () => {
    expect(
      selectConversationForWorkspace(conversations, {
        conversationId: "task-private",
        taskId: "task-a",
      })?.id,
    ).toBe("task-private");
  });

  it("resumes a shared task conversation for a task deep link", () => {
    expect(selectConversationForWorkspace(conversations, { taskId: "task-a" })?.id).toBe("task-shared");
  });

  it("falls back to the most recent visible conversation", () => {
    expect(selectConversationForWorkspace(conversations, {})?.id).toBe("recent");
    expect(selectConversationForWorkspace(conversations, { taskId: "missing" })).toBeNull();
    expect(selectConversationForWorkspace(conversations, { taskId: "missing", conversationId: "recent" })).toBeNull();
    expect(selectConversationForWorkspace([], { taskId: "task-a" })).toBeNull();
  });
});
