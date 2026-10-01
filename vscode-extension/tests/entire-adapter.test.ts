import { describe, expect, it } from "vitest";
import { EntireAdapter } from "../src/adapters/entire-adapter";
import checkpointFixture from "./fixtures/entire-v0.11.3/checkpoint-explain.json";
import sessionFixture from "./fixtures/entire-v0.11.3/session-info.json";
import sessionListFixture from "./fixtures/entire-v0.11.3/session-list.json";
import statusFixture from "./fixtures/entire-v0.11.3/status.json";

const workspacePath = "/tmp/agilecampus-entire-fixture";
const sessionId = "00000000-0000-4000-8000-000000000001";
const checkpointId = "01H00000000000000000000001";

function output(value: unknown) { return { stdout: JSON.stringify(value), stderr: "" }; }

function fixtureRunner(overrides: Record<string, string> = {}) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const run = async (args: readonly string[], cwd: string) => {
    calls.push({ args: [...args], cwd });
    const key = args.join(" ");
    if (overrides[key] !== undefined) return { stdout: overrides[key], stderr: "" };
    if (key === "version") return { stdout: "Entire CLI 0.11.3\n", stderr: "" };
    if (key === "status --json") return output(statusFixture);
    if (key === "session list --json") return output(sessionListFixture);
    if (key === `session info ${sessionId} --json`) return output(sessionFixture);
    if (key === `session info ${sessionId} --transcript`) return { stdout: "{\"type\":\"session\"}\n", stderr: "" };
    if (key === `checkpoint explain ${checkpointId} --json`) return output(checkpointFixture);
    if (key === `checkpoint explain ${checkpointId} --transcript`) return { stdout: "{\"type\":\"checkpoint\"}\n", stderr: "" };
    throw new Error(`Unexpected Entire command: ${key}`);
  };
  return { calls, run };
}

describe("Entire CLI adapter", () => {
  it("keeps capture unavailable until Codex hook trust review is complete", async () => {
    const { calls, run } = fixtureRunner();
    const result = await new EntireAdapter(run).inspectCapabilities(workspacePath);
    expect(result).toMatchObject({ status: "ok", value: {
      cliVersion: "0.11.3", workspaceEnabled: true, codexHooksConfigured: true,
      codexHooksReady: false, automaticPushDisabled: true,
      capabilities: { capture: "unverified", read: "verified", export: "unverified", nativeResume: "unverified", crossMachineResume: "unverified", fork: "unverified", cancel: "unverified" },
    } });
    expect(calls.every((call) => call.cwd === workspacePath)).toBe(true);
  });

  it("fails closed on an Entire version without a verified output contract", async () => {
    const { calls, run } = fixtureRunner({ version: "Entire CLI 0.11.3-rc.99\n" });
    await expect(new EntireAdapter(run).listSessions(workspacePath)).resolves.toMatchObject({ status: "unsupported" });
    expect(calls.map((call) => call.args)).toEqual([["version"]]);
  });

  it("lists only normalized Codex metadata and never returns the prompt field", async () => {
    const { run } = fixtureRunner();
    const result = await new EntireAdapter(run).listSessions(workspacePath);
    expect(result).toMatchObject({ status: "ok", value: [{ sessionId, agent: "Codex", branch: "main", filesTouched: ["checkpoint_probe.py"] }] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROMPT_SHOULD_NOT_BE_RETURNED");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_INCLUDE_OTHER_WORKSPACE_SESSION");
    expect(JSON.stringify(result)).not.toContain("secret-project-file.ts");
  });

  it("captures only the explicitly selected Codex session", async () => {
    const { calls, run } = fixtureRunner();
    const result = await new EntireAdapter(run).capture(workspacePath, sessionId);
    expect(result).toMatchObject({ status: "ok", value: { session: { sessionId, agent: "Codex" }, transcript: "{\"type\":\"session\"}\n" } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SESSION_INFO_PROMPT_MUST_NOT_ESCAPE");
    expect(calls.map((call) => call.args)).toContainEqual(["session", "info", sessionId, "--transcript"]);
    expect(calls.some((call) => call.args.includes("list"))).toBe(false);
  });

  it("refuses to capture a session that belongs to a different worktree", async () => {
    const otherSessionId = "00000000-0000-4000-8000-000000000002";
    const { calls, run } = fixtureRunner({
      [`session info ${otherSessionId} --json`]: JSON.stringify({
        ...sessionFixture,
        session_id: otherSessionId,
        worktree_path: "/tmp/agilecampus-other-fixture",
      }),
    });
    const result = await new EntireAdapter(run).capture(workspacePath, otherSessionId);
    expect(result).toMatchObject({ status: "error" });
    expect(calls.map((call) => call.args)).not.toContainEqual(["session", "info", otherSessionId, "--transcript"]);
  });

  it("fails closed when Entire cannot identify a session's worktree", async () => {
    const { run } = fixtureRunner({
      "session list --json": JSON.stringify([{ session_id: sessionId, agent: "Codex", status: "ended" }]),
    });
    const result = await new EntireAdapter(run).listSessions(workspacePath);
    expect(result).toMatchObject({ status: "unsupported" });
  });

  it("rejects unsafe session and checkpoint references before running the CLI", async () => {
    const { calls, run } = fixtureRunner();
    const adapter = new EntireAdapter(run);
    await expect(adapter.capture(workspacePath, "../../private")).resolves.toMatchObject({ status: "error" });
    await expect(adapter.readCheckpoint(workspacePath, "--help")).resolves.toMatchObject({ status: "error" });
    expect(calls).toEqual([]);
  });

  it("reads a checkpoint transcript and prepares argv without executing resume", async () => {
    const readyStatus = JSON.stringify({ ...statusFixture, codex_hooks: null });
    const { calls, run } = fixtureRunner({ "status --json": readyStatus });
    const adapter = new EntireAdapter(run);
    const read = await adapter.readCheckpoint(workspacePath, checkpointId);
    expect(read).toMatchObject({ status: "ok", value: { checkpointId, branch: "main", transcript: "{\"type\":\"checkpoint\"}\n" } });
    const plan = await adapter.prepareResume(workspacePath, checkpointId);
    expect(plan).toMatchObject({ status: "ok", value: {
      executesAgent: false,
      commands: [
        { executable: "entire", args: ["checkpoint", "resume", "--checkpoint", checkpointId] },
        { executable: "codex", args: ["resume", sessionId] },
      ],
    } });
    expect(calls.some((call) => call.args[0] === "session" && call.args[1] === "resume")).toBe(false);

    const newerCheckpointRunner = fixtureRunner({
      "status --json": readyStatus,
      [`session info ${sessionId} --json`]: JSON.stringify({ ...sessionFixture, last_checkpoint_id: "01H00000000000000000000002" }),
    });
    await expect(new EntireAdapter(newerCheckpointRunner.run).prepareResume(workspacePath, checkpointId)).resolves.toMatchObject({ status: "unsupported" });
  });

  it("does not expose stderr or prompt text when the CLI fails", async () => {
    const run = async () => { throw Object.assign(new Error("PRIVATE_PROMPT_SHOULD_NOT_BE_RETURNED"), { code: "EACCES" }); };
    const result = await new EntireAdapter(run).listSessions(workspacePath);
    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROMPT_SHOULD_NOT_BE_RETURNED");
  });
});
