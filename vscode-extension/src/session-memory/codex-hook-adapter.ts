import { createHash } from "node:crypto";
import { LocalSessionStore, type NewLocalEvent } from "./local-store";

const MAX_HOOK_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_TEXT_LENGTH = 256 * 1024;

type HookRecord = Record<string, unknown>;
export type CodexHookResult = { status: "ignored" | "unsupported" | "recorded"; saved: number; reason?: string };

/**
 * Convert only documented Codex hook events into the local append-only journal.
 * No transcript file is opened: Codex documents transcript_path as unstable.
 */
export async function recordCodexHook(value: unknown, store: LocalSessionStore): Promise<CodexHookResult> {
  if (!isRecord(value) || typeof value.session_id !== "string" || typeof value.cwd !== "string" ||
      typeof value.hook_event_name !== "string") return { status: "unsupported", saved: 0, reason: "Codex hook payload is incomplete" };
  const sessionId = value.session_id;
  const eventName = value.hook_event_name;
  const binding = await store.findActiveBinding("codex", sessionId, value.cwd);
  if (!binding) return { status: "ignored", saved: 0 };

  const sessionRef = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  const turnId = boundedId(value.turn_id);
  if (eventName === "UserPromptSubmit") {
    if (!turnId || typeof value.prompt !== "string" || !value.prompt.trim()) {
      return noteUnsupported(store, binding.sessionKey, "Codex 用户输入缺少稳定 turn ID 或正文");
    }
    const event = boundedEvent({
      kind: "user", text: value.prompt, sourceRef: `codex:${sessionRef}:user:${turnId}`,
    }, `codex:${sessionRef}:user:${turnId}`);
    return appendEvents(store, binding.sessionKey, [event]);
  }

  if (eventName === "PostToolUse") {
    const toolUseId = boundedId(value.tool_use_id);
    if (!turnId || !toolUseId || typeof value.tool_name !== "string") {
      return noteUnsupported(store, binding.sessionKey, "Codex 工具事件缺少稳定 turn/tool ID");
    }
    const ref = `codex:${sessionRef}:tool:${turnId}:${toolUseId}`;
    const toolInput = toText(value.tool_input);
    const toolOutput = toText(value.tool_response);
    const toolName = value.tool_name.slice(0, 256);
    const toolNameValid = value.tool_name.length <= 256;
    const command = isRecord(value.tool_input) && typeof value.tool_input.command === "string"
      ? value.tool_input.command.slice(0, 16_384) : undefined;
    const events: NewLocalEvent[] = [];
    const toolInputText = toolInput === null ? null : `${toolName}\n${toolInput}`;
    if (toolInputText !== null && toolNameValid && toolInputText.length <= MAX_EVENT_TEXT_LENGTH) {
      events.push({ kind: "tool_call", text: toolInputText, toolCallId: toolUseId, ...(command ? { command } : {}), sourceRef: `${ref}:input` });
    } else {
      const reason = toolInput === null ? "Hook 未提供工具输入" : "工具名或输入正文超过 256 KiB";
      events.push({ kind: "gap", text: `工具记录缺口：${reason}，本地未保存完整输入。`, sourceRef: `${ref}:input-gap` });
    }
    if (toolOutput !== null && toolOutput.length <= MAX_EVENT_TEXT_LENGTH) {
      events.push({ kind: "tool_result", text: toolOutput, toolCallId: toolUseId, sourceRef: `${ref}:output` });
    } else {
      const reason = toolOutput === null ? "Hook 未提供工具结果" : "工具输出超过 256 KiB";
      events.push({ kind: "gap", text: `工具记录缺口：${reason}，本地未保存完整结果。`, sourceRef: `${ref}:output-gap` });
    }
    return appendEvents(store, binding.sessionKey, events);
  }

  if (eventName === "Stop" || eventName === "SubagentStop") {
    const message = typeof value.last_assistant_message === "string" ? value.last_assistant_message : "";
    if (!message.trim()) return { status: "ignored", saved: 0 };
    const agent = eventName === "SubagentStop" && typeof value.agent_type === "string" ? `[子 Agent：${value.agent_type}]\n` : "";
    const agentId = eventName === "SubagentStop" ? boundedId(value.agent_id) ?? "unknown" : "main";
    const contentHash = createHash("sha256").update(message).digest("hex").slice(0, 20);
    const event = boundedEvent({
      kind: "assistant", text: `${agent}${message}`, sourceRef: `codex:${sessionRef}:assistant:${turnId ?? "unknown"}:${agentId}:${contentHash}`,
    }, `codex:${sessionRef}:assistant:${turnId ?? "unknown"}:${agentId}:${contentHash}`);
    return appendEvents(store, binding.sessionKey, [event]);
  }

  return { status: "ignored", saved: 0 };
}

export async function runCodexHookCli(storageRoot: string, stdin: NodeJS.ReadableStream): Promise<CodexHookResult> {
  const store = new LocalSessionStore(storageRoot);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > MAX_HOOK_INPUT_BYTES) throw new Error("Codex Hook 输入超过 8 MiB 限制，未保存该事件。请检查超大工具输入或结果。");
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("超过 8 MiB 限制")) {
      await store.recordHookAlert(error.message).catch(() => undefined);
    }
    throw error;
  }
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return recordCodexHook(payload, store);
}

async function appendEvents(store: LocalSessionStore, sessionKey: string, events: NewLocalEvent[]): Promise<CodexHookResult> {
  let saved = 0;
  let currentEvent: NewLocalEvent | undefined;
  try {
    for (const event of events) {
      currentEvent = event;
      const result = await store.append(sessionKey, event);
      if (!result.duplicate) saved += 1;
      await store.clearCaptureFailure(sessionKey, event.sourceRef).catch(() => undefined);
    }
  } catch (error) {
    await store.recordCaptureFailure(sessionKey, error instanceof Error ? error.message : "本机事件写入失败", currentEvent?.sourceRef).catch(() => undefined);
    throw error;
  }
  return { status: "recorded", saved };
}

async function noteUnsupported(store: LocalSessionStore, sessionKey: string, reason: string): Promise<CodexHookResult> {
  await store.recordCaptureFailure(sessionKey, reason).catch(() => undefined);
  return { status: "unsupported", saved: 0, reason };
}

function boundedEvent(event: NewLocalEvent, gapRef: string): NewLocalEvent {
  if (event.text.length <= MAX_EVENT_TEXT_LENGTH) return event;
  return { kind: "gap", text: "会话事件超过 256 KiB，本地未保存该正文。", sourceRef: `${gapRef}:size-gap` };
}

function toText(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return typeof text === "string" ? text : String(value);
  } catch { return "[hook payload could not be serialized]"; }
}

function boundedId(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 512 ? value : null;
}

function isRecord(value: unknown): value is HookRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
