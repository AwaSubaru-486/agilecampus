import type { WebviewMessage } from "../types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWebviewMessage(value: unknown): WebviewMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "refresh": case "connect": case "disconnect": case "selectProject": case "openProject":
      return { type: message.type };
    case "openTask": case "viewAgentWork":
      return typeof message.taskId === "string" && uuidPattern.test(message.taskId)
        ? { type: message.type, taskId: message.taskId }
        : null;
    default: return null;
  }
}
