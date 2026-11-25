import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { listCodexHistory, readCodexHistory } from "../src/session-memory/codex-history";

const roots: string[] = [];
async function newHome() {
  const dir = await mkdtemp(path.join(tmpdir(), "agilecampus-codex-history-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const meta = { type: "session_meta", payload: { base_instructions: "internal" } };
const message = (role: string, content: object[], kinds?: string[]) => ({
  type: "response_item",
  payload: { type: "message", role, content, internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } },
});
const event = (type: string, message: string) => ({ type: "event_msg", payload: { type, message } });
const jsonl = (...rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n");

describe("Codex local history", () => {
  it("lists titled recent sessions and untitled archived sessions without opening transcripts", async () => {
    const home = await newHome();
    const sessions = path.join(home, "sessions", "2026", "11", "25");
    const archive = path.join(home, "archived_sessions");
    await mkdir(sessions, { recursive: true });
    await mkdir(archive);
    const active = "d231bba7-81ca-4191-ba2f-598ec161e7a2";
    const archived = "03325575-5613-4e98-9562-fd43984504c9";
    await writeFile(path.join(sessions, `rollout-2026-11-25T12-01-00-${active}.jsonl`), "unread");
    await writeFile(path.join(archive, `rollout-2026-10-20T12-01-00-${archived}.jsonl`), "unread");
    await writeFile(path.join(home, "session_index.jsonl"), jsonl({ id: active, thread_name: "旧标题" }, { id: active, thread_name: "项目对话" }));
    expect(await listCodexHistory(home)).toEqual([
      expect.objectContaining({ id: active, title: "项目对话", archived: false }),
      expect.objectContaining({ id: archived, title: undefined, archived: true }),
    ]);
  });

  it("extracts visible text and ignores internal records, images, duplicated events and incomplete lines", async () => {
    const file = path.join(await newHome(), "desktop.jsonl");
    await writeFile(file, jsonl(
      meta,
      message("developer", [{ type: "input_text", text: "internal" }]),
      message("user", [
        { type: "input_text", text: "environment payload" },
        { type: "input_text", text: "你好 🧪" },
        { type: "input_image", image_url: "data:image/png;base64,hidden-image" },
      ], ["environments.environment_context", "user.text", "user.image"]),
      event("user_message", "你好 🧪"),
      message("user", [{ type: "input_text", text: "<environment_context>machine info</environment_context>" }]),
      { type: "response_item", payload: { type: "reasoning", summary: ["hidden"] } },
      { type: "response_item", payload: { type: "function_call", arguments: "internal" } },
      message("assistant", [{ type: "output_text", text: "回答" }]),
      event("agent_message", "回答"),
    ) + '\n{"incomplete":');
    expect(await readCodexHistory(file)).toEqual({
      turns: [{ role: "user", text: "你好 🧪" }, { role: "assistant", text: "回答" }],
      omittedLines: 1, earlierTurns: 0, shortenedMessages: 0,
    });
  });

  it("bounds the legacy preview and continues after an oversized row", async () => {
    const file = path.join(await newHome(), "legacy.jsonl");
    await writeFile(file, [
      jsonl(meta, ...Array.from({ length: 301 }, (_, i) => event("user_message", String(i)))),
      "x".repeat(8 * 1024 * 1024 + 1),
      jsonl(event("agent_message", "x".repeat(30000))),
    ].join("\n"));
    const history = await readCodexHistory(file);
    expect(history.turns).toHaveLength(300);
    expect(history.turns[0].text).toBe("2");
    expect(history.earlierTurns).toBe(2);
    expect(history.omittedLines).toBe(1);
    expect(history.shortenedMessages).toBe(1);
    expect(history.turns.at(-1)?.text).toContain("余下文本已省略");
  });

  it("rejects unrelated files, symbolic links and canceled reads", async () => {
    const home = await newHome();
    const file = path.join(home, "unrelated.jsonl");
    await writeFile(file, jsonl(event("user_message", "ordinary JSONL")));
    await expect(readCodexHistory(file)).rejects.toThrow("Codex 会话信息");
    if (process.platform !== "win32") {
      const link = path.join(home, "link.jsonl");
      await symlink(file, link);
      await expect(readCodexHistory(link)).rejects.toThrow("普通的 Codex JSONL");
    }
    await expect(readCodexHistory(file, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
  });
});
