import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexProcessCallbacks, ProcessOutcome } from "../src/adapters/process-runner";
import type { BoundWorkspace } from "../src/commands/checkpoint-support";
import type { TaskDetail } from "../src/types";
import type { ContinuationObserver } from "../src/memory/continuation-reporter";

const ui = vi.hoisted(() => ({
  commands: new Map<string, (request?: unknown, observer?: ContinuationObserver) => Promise<void>>(), documents: [] as string[], errors: [] as string[], output: [] as string[],
  selected: undefined as BoundWorkspace | undefined, task: undefined as TaskDetail | undefined, actorId: "", localId: "",
  cancelLaunch: false, mutateOnConfirm: undefined as (() => Promise<void>) | undefined,
  launches: [] as Array<{ workdir: string; prompt: string; callbacks: CodexProcessCallbacks }>,
  resolveOutcome: undefined as ((outcome: ProcessOutcome) => void) | undefined,
}));

vi.mock("vscode", () => ({
  workspace: {
    isTrusted: true,
    openTextDocument: async ({ content }: { content: string }) => { ui.documents.push(content); return { content }; },
  },
  window: {
    createOutputChannel: () => ({ appendLine: (line: string) => ui.output.push(line), show() {}, dispose() {} }),
    showQuickPick: async (rows: unknown[]) => rows[0],
    showTextDocument: async () => undefined,
    showInformationMessage: async () => undefined,
    showErrorMessage: async (message: string) => { ui.errors.push(message); },
    showWarningMessage: async (_message: string, _options: unknown, accept: string) => {
      if (accept === "启动新的 Codex 会话") {
        if (ui.mutateOnConfirm) await ui.mutateOnConfirm();
        if (ui.cancelLaunch) return undefined;
      }
      return accept;
    },
  },
  commands: {
    registerCommand: (id: string, action: (request?: unknown, observer?: ContinuationObserver) => Promise<void>) => { ui.commands.set(id, action); return { dispose() {} }; },
  },
}));
vi.mock("../src/commands/checkpoint-support", () => ({
  selectBoundWorkspace: async () => ui.selected,
  getLocalOnlyRepositoryId: async () => ui.localId,
  createWorkspaceApi: () => ({ getTask: async () => ui.task, getCurrentActor: async () => ({ id: ui.actorId }) }),
}));
vi.mock("../src/adapters/process-runner", () => ({
  inspectCodexCliVersion: async () => ({ status: "ready", version: "0.153.4" }),
  startCodexContextSession: (workdir: string, prompt: string, callbacks: CodexProcessCallbacks) => {
    ui.launches.push({ workdir, prompt, callbacks });
    return { pid: null, terminate() {}, completion: new Promise<ProcessOutcome>((resolve) => { ui.resolveOutcome = resolve; }) };
  },
}));

import { registerResumeCheckpointCommand } from "../src/commands/resume-checkpoint";
import { createContinuationFixture } from "./fixtures/session-memory/continuation-fixture";
import { CheckpointStore } from "../src/checkpoints/store";
import { AttemptStore } from "../src/attempts/store";
import { LocalSessionStore } from "../src/session-memory/local-store";

const roots: string[] = [];
beforeEach(() => {
  ui.commands.clear(); ui.documents = []; ui.errors = []; ui.output = []; ui.launches = [];
  ui.cancelLaunch = false; ui.mutateOnConfirm = undefined; ui.resolveOutcome = undefined;
});
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(saveMemory = true) {
  const root = await mkdtemp(path.join(tmpdir(), "agile-memory-command-")); roots.push(root);
  const f = await createContinuationFixture(root);
  await new CheckpointStore(f.storageRoot).save(f.checkpoint, []);
  if (saveMemory) await f.artifactStore.saveReceivedExport(f.handoff, f.scope);
  ui.task = f.task; ui.actorId = f.actorId; ui.localId = f.localId;
  ui.selected = {
    folder: { uri: { fsPath: f.workspacePath, toString: () => `file://${f.workspacePath}` }, name: "synthetic", index: 0 } as vscode.WorkspaceFolder,
    binding: { serverOrigin: f.scope.serverOrigin, projectId: f.scope.projectId, workspaceUri: `file://${f.workspacePath}` },
  };
  registerResumeCheckpointCommand({ globalStorageUri: { fsPath: f.storageRoot }, subscriptions: [] } as unknown as vscode.ExtensionContext);
  return f;
}

describe("memory continuation through the existing Agent command", () => {
  it("uses the chosen accepted memory in the launch payload and records the child session and actual final response", async () => {
    const f = await fixture();
    const report = vi.fn<ContinuationObserver>().mockResolvedValue();
    await ui.commands.get("agilecampus.continueTaskMemory")!(undefined, report);
    expect(report.mock.calls.map(([event]) => event.state)).toEqual(["awaiting_confirmation", "launching"]);
    expect(ui.errors).toEqual([]);
    expect(ui.launches).toHaveLength(1);
    expect(ui.launches[0].prompt).toContain(f.handoff.memory.id);
    expect(ui.launches[0].prompt).toContain("cache approach returns stale results");
    expect(ui.documents.some((text) => text.includes("通过，尚未启动"))).toBe(true);
    const providerSessionId = randomUUID();
    await ui.launches[0].callbacks.onSessionStarted(providerSessionId);
    expect(report).toHaveBeenLastCalledWith({ state: "running", attemptId: expect.any(String), sessionConfirmed: true });
    const attempts = new AttemptStore(f.storageRoot);
    const [running] = await attempts.list();
    expect(running).toMatchObject({ state: "running", providerSessionId, memoryInheritance: { memoryId: f.handoff.memory.id } });
    ui.resolveOutcome!({ state: "finished", exitCode: 0, providerSessionId, timedOut: false, agentSummary: "synthetic actual Agent response" });
    await vi.waitFor(async () => { expect((await attempts.read(running.id))?.state).toBe("finished"); });
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ state: "finished", attemptId: running.id }));
    const sessionStore = new LocalSessionStore(f.storageRoot);
    const child = (await sessionStore.list(f.workspacePath)).find((entry) => entry.providerSessionId === providerSessionId)!;
    expect(child.sessionKey).not.toBe(f.binding.sessionKey);
    expect((await sessionStore.readEvents(child.sessionKey)).map((event) => event.text)).toEqual([
      expect.stringContaining(f.handoff.memory.id), "synthetic actual Agent response",
    ]);
    // Wait for the completion handler to release its real cross-process directory lease.
    const nextId = randomUUID();
    await vi.waitFor(async () => { expect(await attempts.acquireWorkdirLease(f.workspacePath, nextId)).toBe(true); });
    await attempts.releaseWorkdirLease(f.workspacePath, nextId);
  });

  it("does not silently fall back to checkpoint text when the task has no accepted memory", async () => {
    const f = await fixture(false);
    await ui.commands.get("agilecampus.continueTaskMemory")!();
    expect(ui.launches).toHaveLength(0);
    expect(ui.errors.join(" ")).toContain("尚无可继承");
    expect(await new AttemptStore(f.storageRoot).list()).toEqual([]);
  });

  it("does not substitute another memory when a task UI requests a missing fixed version", async () => {
    const f = await fixture();
    await ui.commands.get("agilecampus.continueTaskMemory")!({ taskId: f.scope.taskId, materialId: randomUUID() });
    expect(ui.launches).toHaveLength(0);
    expect(ui.errors.join(" ")).toContain("未改用其他版本");
    expect(await new AttemptStore(f.storageRoot).list()).toEqual([]);
  });

  it("creates neither a session nor an attempt when the launch is cancelled", async () => {
    const f = await fixture(); ui.cancelLaunch = true;
    const report = vi.fn<ContinuationObserver>().mockResolvedValue();
    await ui.commands.get("agilecampus.continueTaskMemory")!(undefined, report);
    expect(report.mock.calls.map(([event]) => event.state)).toEqual(["awaiting_confirmation", "cancelled"]);
    expect(ui.launches).toHaveLength(0);
    expect(await new AttemptStore(f.storageRoot).list()).toEqual([]);
  });

  it("rechecks real working files after confirmation and blocks a changed workspace", async () => {
    const f = await fixture();
    ui.mutateOnConfirm = () => writeFile(path.join(f.workspacePath, "search.ts"), "// synthetic concurrent edit\n");
    await ui.commands.get("agilecampus.continueTaskMemory")!();
    expect(ui.launches).toHaveLength(0);
    expect(ui.documents.join("\n")).toContain("未提交或未跟踪改动");
    expect(await new AttemptStore(f.storageRoot).list()).toEqual([]);
  });
});
