import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { classifyCodexCliVersion, parseCodexJsonlEvent, startCodexContextSession, VERIFIED_CODEX_CLI_VERSION } from "../src/adapters/process-runner";

describe("Codex CLI process receipt parsing", () => {
  it("accepts only the verified version and structured lifecycle events", () => {
    expect(VERIFIED_CODEX_CLI_VERSION).toBe("0.153.4");
    expect(classifyCodexCliVersion(null, "codex-cli 0.153.4\n")).toEqual({ status: "ready", version: "0.153.4" });
    expect(classifyCodexCliVersion(Object.assign(new Error("missing"), { code: "ENOENT" }), "")).toMatchObject({ status: "blocked" });
    expect(classifyCodexCliVersion(null, "codex-cli 0.153.5")).toMatchObject({ status: "blocked" });
    expect(parseCodexJsonlEvent('{"type":"thread.started","thread_id":"00000000-0000-4000-8000-000000000001"}'))
      .toEqual({ type: "session-started", sessionId: "00000000-0000-4000-8000-000000000001" });
    expect(parseCodexJsonlEvent('{"type":"turn.completed","turn_id":"turn-1"}')).toEqual({ type: "turn-completed" });
    expect(parseCodexJsonlEvent('{"type":"item.completed","item":{"type":"agent_message","text":"完成说明"}}'))
      .toEqual({ type: "assistant-message", text: "完成说明" });
    expect(parseCodexJsonlEvent('{"type":"turn.completed","last_agent_message":"改动与结果摘要"}'))
      .toEqual({ type: "turn-completed", agentSummary: "改动与结果摘要" });
    expect(parseCodexJsonlEvent('{"type":"turn.failed"}')).toEqual({ type: "turn-failed" });
  });

  it("rejects malformed session IDs and non-JSON output as reliable receipts", () => {
    expect(parseCodexJsonlEvent('{"type":"thread.started","thread_id":"not-an-id"}')).toBe("invalid");
    expect(parseCodexJsonlEvent("raw model output")).toBe("invalid");
    expect(parseCodexJsonlEvent('{"type":"item.completed","item":{"type":"agent_message"}}')).toBeNull();
  });

  it("launches with shell disabled, pipes the prompt, and requires a session ID plus completed turn", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, pid: 1234, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
    let invocation: { command: string; args: readonly string[]; options: { cwd?: string; shell?: boolean } } | undefined;
    const spawned = startCodexContextSession("/tmp/worktree", "test prompt", { onSessionStarted() {} }, ((command, args, options) => {
      invocation = { command, args: args as string[], options: options as { cwd?: string; shell?: boolean } };
      return child;
    }) as never);
    expect(invocation).toMatchObject({ command: "codex", args: ["exec", "--json", "--sandbox", "workspace-write", "--cd", "/tmp/worktree", "-"], options: { cwd: "/tmp/worktree", shell: false } });
    const receivedPrompt = new Promise<string>((resolve) => stdin.on("data", (chunk) => resolve(String(chunk))));
    stdout.write('{"type":"thread.started","thread_id":"00000000-0000-4000-8000-000000000001"}\n');
    stdout.write('{"type":"turn.completed"}\n');
    child.emit("close", 0);
    await expect(receivedPrompt).resolves.toBe("test prompt");
    await expect(spawned.completion).resolves.toMatchObject({ state: "finished", providerSessionId: "00000000-0000-4000-8000-000000000001", exitCode: 0 });
  });

  it("does not call an exit successful without a real session ID", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, pid: 1234, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
    const spawned = startCodexContextSession("/tmp/worktree", "test", { onSessionStarted() {} }, (() => child) as never);
    stdout.write('{"type":"turn.completed"}\n');
    child.emit("close", 0);
    await expect(spawned.completion).resolves.toMatchObject({ state: "awaiting_confirmation", providerSessionId: null });
  });

  it("reports nonzero exit as failed and never marks provider errors as running", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, pid: 1234, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
    const spawned = startCodexContextSession("/tmp/worktree", "test", { onSessionStarted() {} }, (() => child) as never);
    stdout.write('{"type":"error","message":"not logged"}\n');
    child.emit("close", 1);
    await expect(spawned.completion).resolves.toMatchObject({ state: "failed", exitCode: 1 });
  });

  it("marks timeout as failure even if the child reports an exit", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let child: ChildProcessWithoutNullStreams;
    child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, pid: 1234, kill: () => { setTimeout(() => child.emit("close", 143), 0); return true; } }) as unknown as ChildProcessWithoutNullStreams;
    const spawned = startCodexContextSession("/tmp/worktree", "test", { onSessionStarted() {} }, (() => child) as never, 5);
    await expect(spawned.completion).resolves.toMatchObject({ state: "failed", timedOut: true });
  });
});
