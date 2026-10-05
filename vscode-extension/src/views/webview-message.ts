import type { WebviewMessage } from "../types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWebviewMessage(value: unknown): WebviewMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "refresh": case "connect": case "disconnect": case "selectProject": case "openProject":
      return { type: message.type };
    case "disableCodexCapture":
      return onlyKeys(message, ["type"]) ? { type: "disableCodexCapture" } : null;
    case "dismissHookAlert":
      return onlyKeys(message, ["type", "alertId"]) && typeof message.alertId === "string" && uuidPattern.test(message.alertId)
        ? { type: "dismissHookAlert", alertId: message.alertId }
        : null;
    case "openTask": case "viewAgentWork":
      return typeof message.taskId === "string" && uuidPattern.test(message.taskId)
        ? { type: message.type, taskId: message.taskId }
        : null;
    case "bindSession": case "enableCodexCapture": case "refreshSessionMemory":
      return onlyKeys(message, ["type", "taskId"]) && typeof message.taskId === "string" && uuidPattern.test(message.taskId)
        ? { type: message.type, taskId: message.taskId }
        : null;
    case "openSessionRecord": case "stopSessionCapture":
      return onlyKeys(message, ["type", "taskId", "sessionKey"]) && typeof message.taskId === "string" && uuidPattern.test(message.taskId) &&
        typeof message.sessionKey === "string" && uuidPattern.test(message.sessionKey)
        ? { type: message.type, taskId: message.taskId, sessionKey: message.sessionKey }
        : null;
    default: return null;
  }
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
