import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import type {
  AdapterResult,
  CapturedSession,
  CapabilityState,
  CheckpointSummary,
  PreparedCommand,
  ReadCheckpoint,
  ResumePlan,
  SessionAdapter,
  SessionCapabilities,
  SessionSummary,
} from "./session-adapter";

const VERIFIED_ENTIRE_VERSION = "0.11.3";
const COMMAND_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const CODEX_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKPOINT_ID = /^(?:[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{12})$/i;

type CommandOutput = { stdout: string; stderr: string };
type CommandRunner = (args: readonly string[], cwd: string) => Promise<CommandOutput>;
type EntireStatus = {
  enabled: boolean;
  agents: string[];
  checkpoint_push_disabled?: boolean;
};
type EntireSession = {
  session_id: string;
  agent: string;
  model?: string;
  status: string;
  branch?: string;
  started_at?: string;
  ended_at?: string;
  turns?: number;
  last_checkpoint_id?: string;
  files_touched?: string[];
};
type EntireCheckpoint = {
  checkpoint_id: string;
  branch?: string;
  message?: string;
  date?: string;
  sessions: Array<{ session_id: string; agent: string; model?: string }>;
  files_touched?: string[];
};

export class EntireAdapter implements SessionAdapter {
  constructor(private readonly run: CommandRunner = runEntire) {}

  async inspectCapabilities(workspacePath: string): Promise<AdapterResult<SessionCapabilities>> {
    const cwd = this.validCwd(workspacePath);
    if (!cwd) return { status: "error", reason: "工作区路径无效" };
    const version = await this.entireVersion(cwd);
    if (version.status !== "ok") return version;
    if (version.value !== VERIFIED_ENTIRE_VERSION) {
      return { status: "unsupported", reason: `尚未验证 Entire CLI ${version.value}，当前适配器只接受 ${VERIFIED_ENTIRE_VERSION}` };
    }
    const statusOutput = await this.command(["status", "--json"], cwd);
    if (statusOutput.status !== "ok") return statusOutput;
    const parsed = parseJson(statusOutput.value.stdout);
    const status = parsed ? parseEntireStatus(parsed) : null;
    if (!status) return { status: "error", reason: "Entire 返回了无法识别的工作区状态" };

    const codexHooksConfigured = status.agents.some((agent) => agent.toLowerCase() === "codex");
    const ready = status.enabled && codexHooksConfigured;
    const capability = (ready ? "verified" : "unverified") as CapabilityState;
    const capabilities: SessionCapabilities["capabilities"] = {
      capture: capability,
      read: capability,
      export: "unverified",
      nativeResume: capability,
      crossMachineResume: "unverified",
      fork: "unverified",
      cancel: "unverified",
    };
    const notes = ready
      ? [
          "Codex session hooks are configured; normal use still requires the user to approve the hooks in Codex.",
          "Local transcript reading was verified; portable checkpoint export has not been verified.",
        ]
      : ["Enable Entire for Codex only in a disposable repository before capture testing."];
    if (status.checkpoint_push_disabled === false) notes.push("Entire may automatically push checkpoint data; disable push_sessions before local-only use.");
    if (status.checkpoint_push_disabled === undefined) notes.push("The CLI did not report checkpoint push state; treat it as unverified.");
    return {
      status: "ok",
      value: {
        provider: "Codex CLI",
        cliVersion: version.value,
        workspaceEnabled: status.enabled,
        codexHooksConfigured,
        automaticPushDisabled: typeof status.checkpoint_push_disabled === "boolean" ? status.checkpoint_push_disabled : null,
        capabilities,
        notes,
      },
    };
  }

  async listSessions(workspacePath: string): Promise<AdapterResult<SessionSummary[]>> {
    const cwd = this.validCwd(workspacePath);
    if (!cwd) return { status: "error", reason: "工作区路径无效" };
    const compatible = await this.requireSupportedVersion(cwd);
    if (compatible.status !== "ok") return compatible;
    const output = await this.command(["session", "list", "--json"], cwd);
    if (output.status !== "ok") return output;
    const value = parseJson(output.value.stdout);
    if (!Array.isArray(value)) return { status: "error", reason: "Entire 返回了无法识别的 session 列表" };
    const sessions: SessionSummary[] = [];
    for (const item of value) {
      if (!isRecord(item) || typeof item.worktree_path !== "string" || !path.isAbsolute(item.worktree_path)) {
        return { status: "unsupported", reason: "Entire session 缺少可验证的工作区归属；为避免混入其他项目会话，已停止列出" };
      }
      if (!matchesWorkspace(item.worktree_path, cwd)) continue;
      const parsed = parseSession(item);
      if (parsed?.agent === "Codex") sessions.push(parsed);
    }
    return { status: "ok", value: sessions };
  }

  async capture(workspacePath: string, sessionId: string): Promise<AdapterResult<CapturedSession>> {
    const cwd = this.validCwd(workspacePath);
    if (!cwd) return { status: "error", reason: "工作区路径无效" };
    if (!CODEX_SESSION_ID.test(sessionId)) return { status: "error", reason: "Codex session ID 格式无效" };
    const compatible = await this.requireSupportedVersion(cwd);
    if (compatible.status !== "ok") return compatible;
    const metadataOutput = await this.command(["session", "info", sessionId, "--json"], cwd);
    if (metadataOutput.status !== "ok") return metadataOutput;
    const metadataValue = parseJson(metadataOutput.value.stdout);
    const session = metadataValue ? parseSession(metadataValue) : null;
    if (!session || session.sessionId !== sessionId || session.agent !== "Codex" || !isRecord(metadataValue) || !matchesWorkspace(metadataValue.worktree_path, cwd)) {
      return { status: "error", reason: "所选记录不是可读取的 Codex session" };
    }
    const transcriptOutput = await this.command(["session", "info", sessionId, "--transcript"], cwd);
    if (transcriptOutput.status !== "ok") return transcriptOutput;
    const transcript = transcriptOutput.value.stdout;
    if (!transcript.trim()) return { status: "error", reason: "Entire 未返回 session transcript" };
    return { status: "ok", value: { session, transcript, byteLength: Buffer.byteLength(transcript, "utf8") } };
  }

  async readCheckpoint(workspacePath: string, checkpointId: string): Promise<AdapterResult<ReadCheckpoint>> {
    const cwd = this.validCwd(workspacePath);
    if (!cwd) return { status: "error", reason: "工作区路径无效" };
    if (!CHECKPOINT_ID.test(checkpointId)) return { status: "error", reason: "checkpoint ID 格式无效" };
    const checkpoint = await this.checkpointSummary(cwd, checkpointId);
    if (checkpoint.status !== "ok") return checkpoint;
    const transcriptOutput = await this.command(["checkpoint", "explain", checkpointId, "--transcript"], cwd);
    if (transcriptOutput.status !== "ok") return transcriptOutput;
    const transcript = transcriptOutput.value.stdout;
    if (!transcript.trim()) return { status: "error", reason: "Entire 未返回 checkpoint transcript" };
    return { status: "ok", value: { ...checkpoint.value, transcript, byteLength: Buffer.byteLength(transcript, "utf8") } };
  }

  async prepareResume(workspacePath: string, checkpointId: string): Promise<AdapterResult<ResumePlan>> {
    const cwd = this.validCwd(workspacePath);
    if (!cwd) return { status: "error", reason: "工作区路径无效" };
    if (!CHECKPOINT_ID.test(checkpointId)) return { status: "error", reason: "checkpoint ID 格式无效" };
    const checkpoint = await this.checkpointSummary(cwd, checkpointId);
    if (checkpoint.status !== "ok") return checkpoint;
    const selectedSession = checkpoint.value.sessions.at(-1);
    if (!selectedSession) return { status: "unsupported", reason: "checkpoint 不包含可接续的 session" };
    if (!checkpoint.value.branch || !isSafeBranch(checkpoint.value.branch)) {
      return { status: "unsupported", reason: "checkpoint 缺少可安全传递的分支名" };
    }
    const commands: PreparedCommand[] = [
      { executable: "entire", args: ["session", "resume", checkpoint.value.branch] },
      { executable: "codex", args: ["exec", "resume", selectedSession.sessionId] },
    ];
    return {
      status: "ok",
      value: {
        checkpointId,
        sessionId: selectedSession.sessionId,
        branch: checkpoint.value.branch,
        commands,
        executesAgent: false,
        warning: "执行 Entire resume 前必须重新检查分支和工作区改动；此计划不会切换分支或启动 Agent。",
      },
    };
  }

  private async requireSupportedVersion(cwd: string): Promise<AdapterResult<string>> {
    const version = await this.entireVersion(cwd);
    if (version.status !== "ok") return version;
    if (version.value !== VERIFIED_ENTIRE_VERSION) {
      return { status: "unsupported", reason: `尚未验证 Entire CLI ${version.value}，当前适配器只接受 ${VERIFIED_ENTIRE_VERSION}` };
    }
    return version;
  }

  private async entireVersion(cwd: string): Promise<AdapterResult<string>> {
    const output = await this.command(["version"], cwd);
    if (output.status !== "ok") return output;
    const match = output.value.stdout.match(/\bEntire CLI (\d+\.\d+\.\d+)\b/);
    return match ? { status: "ok", value: match[1] } : { status: "error", reason: "无法识别 Entire CLI 版本" };
  }

  private async checkpointSummary(cwd: string, checkpointId: string): Promise<AdapterResult<CheckpointSummary>> {
    const compatible = await this.requireSupportedVersion(cwd);
    if (compatible.status !== "ok") return compatible;
    const metadataOutput = await this.command(["checkpoint", "explain", checkpointId, "--json"], cwd);
    if (metadataOutput.status !== "ok") return metadataOutput;
    const metadataValue = parseJson(metadataOutput.value.stdout);
    const checkpoint = metadataValue ? parseCheckpoint(metadataValue) : null;
    if (!checkpoint || checkpoint.checkpointId !== checkpointId) {
      return { status: "error", reason: "Entire 返回了无法识别的 checkpoint" };
    }
    return { status: "ok", value: checkpoint };
  }

  private async command(args: readonly string[], cwd: string): Promise<AdapterResult<CommandOutput>> {
    try {
      return { status: "ok", value: await this.run(args, cwd) };
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : null;
      return code === "ENOENT"
        ? { status: "unsupported", reason: "未找到 Entire CLI；请安装并确认 entire 在 PATH 中" }
        : { status: "error", reason: "Entire 命令失败；未向界面暴露命令输出" };
    }
  }

  private validCwd(workspacePath: string): string | null {
    return path.isAbsolute(workspacePath) ? path.resolve(workspacePath) : null;
  }
}

function runEntire(args: readonly string[], cwd: string): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ENTIRE_TELEMETRY_OPTOUT: "1" };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete env[name];
    execFile("entire", [...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const failure = error as NodeJS.ErrnoException;
        reject(Object.assign(new Error("Entire CLI command failed"), { code: failure.code }));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function parseSession(value: unknown): SessionSummary | null {
  if (!isRecord(value) || typeof value.session_id !== "string" || typeof value.agent !== "string" || typeof value.status !== "string") return null;
  if (!CODEX_SESSION_ID.test(value.session_id) || value.agent.toLowerCase() !== "codex") return null;
  return {
    sessionId: value.session_id,
    agent: "Codex",
    model: optionalString(value.model),
    status: value.status,
    branch: optionalString(value.branch),
    startedAt: optionalString(value.started_at),
    endedAt: optionalString(value.ended_at),
    turns: optionalNumber(value.turns),
    lastCheckpointId: optionalString(value.last_checkpoint_id),
    filesTouched: stringArray(value.files_touched),
  };
}

function parseCheckpoint(value: unknown): CheckpointSummary | null {
  if (!isRecord(value) || typeof value.checkpoint_id !== "string" || !Array.isArray(value.sessions)) return null;
  const sessions = value.sessions.map((item) => {
    if (!isRecord(item) || typeof item.session_id !== "string" || typeof item.agent !== "string") return null;
    if (!CODEX_SESSION_ID.test(item.session_id) || item.agent.toLowerCase() !== "codex") return null;
    return { sessionId: item.session_id, agent: "Codex" as const, model: optionalString(item.model) };
  });
  if (sessions.some((item) => item === null)) return null;
  return {
    checkpointId: value.checkpoint_id,
    branch: optionalString(value.branch),
    message: optionalString(value.message),
    date: optionalString(value.date),
    sessions: sessions.filter((item): item is NonNullable<typeof item> => item !== null),
    filesTouched: stringArray(value.files_touched),
  };
}

function parseEntireStatus(value: unknown): EntireStatus | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || !Array.isArray(value.agents)) return null;
  if (!value.agents.every((agent) => typeof agent === "string")) return null;
  return {
    enabled: value.enabled,
    agents: value.agents,
    ...(typeof value.checkpoint_push_disabled === "boolean" ? { checkpoint_push_disabled: value.checkpoint_push_disabled } : {}),
  };
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function matchesWorkspace(worktreePath: unknown, cwd: string): boolean {
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath)) return false;
  return canonicalPath(worktreePath) === canonicalPath(cwd);
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  try { return realpathSync.native(resolved); }
  catch { return resolved; }
}

function isSafeBranch(branch: string): boolean {
  return branch.length > 0 && branch.length <= 250 && !branch.startsWith("-") && !/[\u0000-\u0020~^:?*[\\]/.test(branch) && !branch.includes("..") && !branch.includes("@{") && !branch.endsWith("/") && !branch.endsWith(".") && !branch.includes("//");
}
