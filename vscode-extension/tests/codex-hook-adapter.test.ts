import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { recordCodexHook, runCodexHookCli } from "../src/session-memory/codex-hook-adapter";
import { LocalSessionStore } from "../src/session-memory/local-store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-codex-hook-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const subdir = path.join(workspace, "packages", "app");
  await mkdir(subdir, { recursive: true });
  const store = new LocalSessionStore(path.join(root, "storage"));
  const binding = await store.bind({ provider: "codex", providerSessionId: "codex-session-1", workspacePath: workspace, projectId: "project-1", taskId: "task-1" });
  return { root, workspace, subdir, store, binding };
}

describe("Codex local session hook adapter", () => {
  it("records only explicitly bound sessions in the bound workspace tree", async () => {
    const { subdir, store, binding } = await fixture();
    const payload = { session_id: "codex-session-1", cwd: subdir, hook_event_name: "UserPromptSubmit", turn_id: "turn-1", prompt: "Fix the failing test" };
    expect(await recordCodexHook(payload, store)).toMatchObject({ status: "recorded", saved: 1 });
    expect(await recordCodexHook(payload, store)).toMatchObject({ status: "recorded", saved: 0 });
    const page = await store.readEventsPage(binding.sessionKey);
    expect(page.events).toMatchObject([{ kind: "user", text: "Fix the failing test", timestamp: null }]);
    expect(JSON.stringify(page.events)).not.toContain("codex-session-1");
  });

  it("ignores sessions that have not been explicitly associated", async () => {
    const { subdir, store } = await fixture();
    expect(await recordCodexHook({ session_id: "other-session", cwd: subdir, hook_event_name: "UserPromptSubmit", turn_id: "turn-1", prompt: "secret" }, store))
      .toMatchObject({ status: "ignored", saved: 0 });
  });

  it("records tool input/output and assistant completion with local source references", async () => {
    const { subdir, store, binding } = await fixture();
    const tool = {
      session_id: "codex-session-1", cwd: subdir, hook_event_name: "PostToolUse", turn_id: "turn-1",
      tool_name: "Bash", tool_use_id: "tool-1", tool_input: { command: "npm test" }, tool_response: { exit_code: 0, output: "passed" },
    };
    expect(await recordCodexHook(tool, store)).toMatchObject({ status: "recorded", saved: 2 });
    expect(await recordCodexHook({ ...tool, hook_event_name: "Stop", last_assistant_message: "Tests pass." }, store))
      .toMatchObject({ status: "recorded", saved: 1 });
    const events = (await store.readEvents(binding.sessionKey)).map(({ kind, text, command }) => ({ kind, text, command }));
    expect(events).toEqual([
      { kind: "tool_call", text: 'Bash\n{\n  "command": "npm test"\n}', command: "npm test" },
      { kind: "tool_result", text: '{\n  "exit_code": 0,\n  "output": "passed"\n}', command: undefined },
      { kind: "assistant", text: "Tests pass.", command: undefined },
    ]);
  });

  it("marks oversized tool text as a gap instead of silently truncating it", async () => {
    const { subdir, store, binding } = await fixture();
    const result = await recordCodexHook({
      session_id: "codex-session-1", cwd: subdir, hook_event_name: "PostToolUse", turn_id: "turn-1",
      tool_name: "Bash", tool_use_id: "tool-1", tool_input: { command: "echo x" }, tool_response: "x".repeat(256 * 1024 + 1),
    }, store);
    expect(result.saved).toBe(2);
    expect((await store.readEvents(binding.sessionKey)).map(({ kind, text }) => [kind, text])).toContainEqual(["gap", "工具记录缺口：工具输出超过 256 KiB，本地未保存完整结果。"]);
  });

  it("runs the stdin hook adapter against the same local store used by the extension", async () => {
    const { root, subdir, store, binding } = await fixture();
    const payload = { session_id: "codex-session-1", cwd: subdir, hook_event_name: "UserPromptSubmit", turn_id: "turn-cli", prompt: "resume from the last checkpoint" };
    const result = await runCodexHookCli(path.join(root, "storage"), Readable.from([JSON.stringify(payload)]));
    expect(result).toMatchObject({ status: "recorded", saved: 1 });
    expect((await store.readEvents(binding.sessionKey)).map((event) => event.text)).toEqual([payload.prompt]);
  });
});
