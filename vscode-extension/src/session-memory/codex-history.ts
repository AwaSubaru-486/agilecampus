import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import * as path from "node:path";

const ROLLOUT = /^rollout-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)-([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\.jsonl$/i;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_LINE_LENGTH = 8 * 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 24_000;
const MAX_PREVIEW_LENGTH = 1_000_000;
const MAX_MESSAGES = 300;
const MAX_RECENT = 100;

export type CodexHistoryEntry = { file: string; id: string; date: string; title?: string; archived: boolean };
type Turn = { role: "user" | "assistant"; text: string };
export type CodexHistory = { turns: Turn[]; omittedLines: number; earlierTurns: number; shortenedMessages: number };

function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

function jsonRow(line: string): Record<string, unknown> | undefined {
  try { return object(JSON.parse(line)); } catch { return undefined; }
}

async function openRegularFile(file: string) {
  const before = await lstat(file);
  if (!before.isFile()) throw new Error("请选择普通的 Codex JSONL 会话文件。");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new Error("会话文件已变更，请重新选择。");
    return { handle, size: info.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function directoryEntries(folder: string) {
  try {
    if (!(await lstat(folder)).isDirectory()) return [];
    return await readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function listCodexHistory(home: string): Promise<CodexHistoryEntry[]> {
  const sessions: CodexHistoryEntry[] = [];
  async function collect(folder: string, depth: number, archived: boolean) {
    for (const entry of await directoryEntries(folder)) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory() && depth > 0 && (depth === 3 ? /^\d{4}$/ : /^\d{2}$/).test(entry.name)) {
        await collect(file, depth - 1, archived);
      }
      if (!entry.isFile()) continue;
      const match = ROLLOUT.exec(entry.name);
      if (match) sessions.push({ file, id: match[2], date: match[1], archived });
    }
  }
  await Promise.all([collect(path.join(home, "sessions"), 3, false), collect(path.join(home, "archived_sessions"), 0, true)]);
  if (!sessions.length) return [];
  const names = await sessionTitles(path.join(home, "session_index.jsonl"));
  sessions.sort((a, b) => b.date.localeCompare(a.date) || Number(a.archived) - Number(b.archived));
  const seen = new Set<string>();
  return sessions.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, MAX_RECENT).map((entry) => ({ ...entry, title: names.get(entry.id) }));
}

async function sessionTitles(file: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    const { handle, size } = await openRegularFile(file);
    let tail: string;
    const offset = Math.max(0, size - MAX_INDEX_BYTES);
    try {
      const bytes = Buffer.alloc(size - offset);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      tail = bytes.toString("utf8", 0, bytesRead);
    } finally { await handle.close(); }
    const lines = tail.split("\n");
    if (offset) lines.shift();
    for (const line of lines) {
      const row = jsonRow(line);
      if (typeof row?.id === "string" && typeof row.thread_name === "string" && row.thread_name.trim()) {
        titles.set(row.id, row.thread_name.replace(/\s+/g, " ").trim().slice(0, 160));
      }
    }
  } catch { /* The file list remains usable without the optional title index. */ }
  return titles;
}

function message(row: Record<string, unknown>): Turn | undefined {
  const payload = object(row.payload);
  if (!payload || row.type !== "response_item" || payload.type !== "message" ||
      (payload.role !== "user" && payload.role !== "assistant") || !Array.isArray(payload.content)) return;
  const kinds = object(payload.internal_chat_message_metadata_passthrough)?.content_item_kinds;
  const text: string[] = [];
  payload.content.forEach((part: unknown, index: number) => {
    const content = object(part);
    if (typeof content?.text !== "string" || !content.text.trim()) return;
    if (payload.role === "assistant" && content.type === "output_text") text.push(content.text);
    if (payload.role === "user" && content.type === "input_text") {
      const kind = Array.isArray(kinds) ? kinds[index] : undefined;
      if (typeof kind === "string" && kind !== "unknown" && !kind.startsWith("user.")) return;
      if (/^\s*<(?:environment_context|turn_aborted|subagent_notification|skills_instructions)(?:\s|>)/.test(content.text)) return;
      text.push(content.text);
    }
  });
  if (text.length) return { role: payload.role, text: text.join("\n\n") };
}

function legacyMessage(row: Record<string, unknown>): Turn | undefined {
  const payload = object(row.payload);
  if (row.type !== "event_msg" || typeof payload?.message !== "string" || !payload.message.trim()) return;
  if (payload.type === "user_message") return { role: "user", text: payload.message };
  if (payload.type === "agent_message") return { role: "assistant", text: payload.message };
}

class Preview {
  readonly turns: Turn[] = [];
  earlierTurns = 0;
  shortenedMessages = 0;
  private length = 0;

  append(turn: Turn): void {
    if (turn.text.length > MAX_MESSAGE_LENGTH) {
      turn.text = turn.text.slice(0, MAX_MESSAGE_LENGTH) + "\n[该条消息过长，余下文本已省略]";
      this.shortenedMessages++;
    }
    this.turns.push(turn);
    this.length += turn.text.length;
    while (this.turns.length > MAX_MESSAGES || this.length > MAX_PREVIEW_LENGTH) {
      this.length -= this.turns.shift()!.text.length;
      this.earlierTurns++;
    }
  }
}

export async function readCodexHistory(file: string, signal?: AbortSignal): Promise<CodexHistory> {
  if (path.extname(file).toLowerCase() !== ".jsonl") throw new Error("请选择 Codex 的 JSONL 会话文件。");
  const { handle, size } = await openRegularFile(file);
  try {
    if (!size || size > MAX_FILE_BYTES) throw new Error("会话文件为空或超出 512 MiB 的预览上限。");
    const current = new Preview();
    const legacy = new Preview();
    let isCodexSession = false;
    let omittedLines = 0;
    let line = "";
    let tooLong = false;
    function finishLine() {
      if (tooLong) omittedLines++;
      else if (line.trim()) {
        const row = jsonRow(line);
        if (!row) omittedLines++;
        else if (row.type === "session_meta" && object(row.payload)) isCodexSession = true;
        else {
          const turn = message(row);
          const oldTurn = legacyMessage(row);
          if (turn) current.append(turn);
          if (oldTurn) legacy.append(oldTurn);
        }
      }
      line = "";
      tooLong = false;
    }
    signal?.throwIfAborted();
    const stream = handle.createReadStream({ start: 0, end: size - 1, encoding: "utf8", autoClose: false, signal });
    for await (const chunk of stream) {
      let start = 0;
      for (let end = chunk.indexOf("\n"); end !== -1; end = chunk.indexOf("\n", start)) {
        append(chunk.slice(start, end));
        finishLine();
        start = end + 1;
      }
      append(chunk.slice(start));
    }
    finishLine();
    if (!isCodexSession) throw new Error("这个文件没有可识别的 Codex 会话信息。");
    const preview = current.turns.length ? current : legacy;
    return { turns: preview.turns, omittedLines, earlierTurns: preview.earlierTurns, shortenedMessages: preview.shortenedMessages };

    function append(fragment: string) {
      if (tooLong) return;
      if (line.length + fragment.length > MAX_LINE_LENGTH) {
        tooLong = true;
        line = "";
      } else line += fragment;
    }
  } finally { await handle.close(); }
}
