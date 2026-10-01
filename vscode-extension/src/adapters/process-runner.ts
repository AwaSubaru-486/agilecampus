import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export const VERIFIED_CODEX_CLI_VERSION = "0.153.4";
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_RUN_MS = 2 * 60 * 60 * 1000;

export type ProcessOutcome = {
  state: "finished" | "failed" | "awaiting_confirmation";
  exitCode: number | null;
  providerSessionId: string | null;
  timedOut: boolean;
  agentSummary: string | null;
};

export type CodexProcess = {
  pid: number | null;
  completion: Promise<ProcessOutcome>;
  terminate(): void;
};

export type CodexProcessCallbacks = {
  onSessionStarted(sessionId: string): Promise<void> | void;
};

export async function inspectCodexCliVersion(): Promise<{ status: "ready"; version: string } | { status: "blocked"; reason: string }> {
  const result = await new Promise<{ error: NodeJS.ErrnoException | null; stdout: string }>((resolve) => {
    execFile("codex", ["--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true }, (error, stdout) => {
      resolve({ error: error as NodeJS.ErrnoException | null, stdout: String(stdout) });
    });
  });
  return classifyCodexCliVersion(result.error, result.stdout);
}

export function classifyCodexCliVersion(error: NodeJS.ErrnoException | null, stdout: string): { status: "ready"; version: string } | { status: "blocked"; reason: string } {
  if (error?.code === "ENOENT") return { status: "blocked", reason: "未找到 Codex CLI；请先安装并确保 codex 在 PATH 中。" };
  if (error) return { status: "blocked", reason: "无法读取 Codex CLI 版本；未启动 Agent。" };
  const match = /^codex-cli (\d+\.\d+\.\d+)$/m.exec(stdout.trim());
  if (!match) return { status: "blocked", reason: "Codex CLI 版本格式无法识别；未启动 Agent。" };
  if (match[1] !== VERIFIED_CODEX_CLI_VERSION) {
    return { status: "blocked", reason: `当前只核验过 Codex CLI ${VERIFIED_CODEX_CLI_VERSION}，检测到 ${match[1]}；未启动 Agent。` };
  }
  return { status: "ready", version: match[1] };
}

export function startCodexContextSession(
  workspacePath: string,
  prompt: string,
  callbacks: CodexProcessCallbacks,
  spawnImpl: typeof spawn = spawn,
  maxRunMs = MAX_RUN_MS,
): CodexProcess {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete env[name];
  const child = spawnImpl("codex", ["exec", "--json", "--sandbox", "workspace-write", "--cd", workspacePath, "-"], {
    cwd: workspacePath,
    env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  return observeCodexProcess(child, prompt, callbacks, maxRunMs);
}

function observeCodexProcess(child: ChildProcessWithoutNullStreams, prompt: string, callbacks: CodexProcessCallbacks, maxRunMs: number): CodexProcess {
  const decoder = new StringDecoder("utf8");
  let stdoutBuffer = "";
  let outputBytes = 0;
  let providerSessionId: string | null = null;
  let sawCompletedTurn = false;
  let sawFailedTurn = false;
  let agentSummary: string | null = null;
  let timedOut = false;
  let protocolFailed = false;
  let callbackChain = Promise.resolve();
  let settled = false;
  let timeout: NodeJS.Timeout;

  const process = new Promise<ProcessOutcome>((resolve) => {
    const finish = async (exitCode: number | null): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      await callbackChain;
      const cleanFinish = exitCode === 0 && Boolean(providerSessionId) && sawCompletedTurn && !sawFailedTurn && !timedOut && !protocolFailed;
      resolve({
        state: cleanFinish ? "finished" : exitCode === 0 && !timedOut && !sawFailedTurn ? "awaiting_confirmation" : "failed",
        exitCode,
        providerSessionId,
        timedOut,
        agentSummary,
      });
    };
    const close = (exitCode: number | null): void => { void finish(exitCode); };
    const parseLine = (line: string): void => {
      if (!line.trim()) return;
      const event = parseCodexJsonlEvent(line);
      if (event === "invalid") { protocolFailed = true; return; }
      if (!event) return;
      if (event.type === "session-started") {
        providerSessionId = event.sessionId;
        callbackChain = callbackChain.then(() => callbacks.onSessionStarted(event.sessionId)).catch(() => { sawFailedTurn = true; });
      } else if (event.type === "assistant-message") agentSummary = event.text;
      else if (event.type === "turn-completed") {
        sawCompletedTurn = true;
        if (event.agentSummary) agentSummary = event.agentSummary;
      }
      else if (event.type === "turn-failed") sawFailedTurn = true;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        protocolFailed = true;
        child.kill("SIGTERM");
        return;
      }
      stdoutBuffer += decoder.write(chunk);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) parseLine(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        protocolFailed = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", () => { sawFailedTurn = true; close(null); });
    child.on("close", (exitCode) => {
      stdoutBuffer += decoder.end();
      if (stdoutBuffer.trim()) parseLine(stdoutBuffer);
      close(exitCode);
    });
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 5_000).unref();
    }, maxRunMs);
    timeout.unref();
    child.stdin.on("error", () => { /* A process closing stdin is reported by its exit and JSONL receipt. */ });
    child.stdin.end(prompt, "utf8");
  });
  return {
    pid: child.pid ?? null,
    completion: process,
    terminate: () => {
      if (settled) return;
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 5_000);
      forceKill.unref();
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CodexJsonlEvent =
  | { type: "session-started"; sessionId: string }
  | { type: "assistant-message"; text: string }
  | { type: "turn-completed"; agentSummary?: string }
  | { type: "turn-failed" };

export function parseCodexJsonlEvent(line: string): CodexJsonlEvent | "invalid" | null {
  let value: unknown;
  try { value = JSON.parse(line); }
  catch { return line.trim() ? "invalid" : null; }
  if (!record(value) || typeof value.type !== "string") return "invalid";
  if (value.type === "thread.started") {
    return typeof value.thread_id === "string" && isUuid(value.thread_id)
      ? { type: "session-started", sessionId: value.thread_id }
      : "invalid";
  }
  if (value.type === "item.completed" && record(value.item) && value.item.type === "agent_message") {
    const text = extractMessageText(value.item);
    return text ? { type: "assistant-message", text } : null;
  }
  if (value.type === "turn.completed") {
    return {
      type: "turn-completed",
      ...(typeof value.last_agent_message === "string" && value.last_agent_message.trim()
        ? { agentSummary: value.last_agent_message.slice(0, 24_000) }
        : {}),
    };
  }
  if (value.type === "turn.failed" || value.type === "error") return { type: "turn-failed" };
  return null;
}

function extractMessageText(item: Record<string, unknown>): string | null {
  if (typeof item.text === "string" && item.text.trim()) return item.text.slice(0, 24_000);
  if (!Array.isArray(item.content)) return null;
  const text = item.content.map((block) => {
    if (typeof block === "string") return block;
    if (record(block) && typeof block.text === "string") return block.text;
    return "";
  }).filter(Boolean).join("\n").trim();
  return text ? text.slice(0, 24_000) : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
