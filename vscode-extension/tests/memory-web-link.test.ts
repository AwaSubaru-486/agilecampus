import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { BoundWorkspace } from "../src/commands/checkpoint-support";
import type { TaskDetail } from "../src/types";
import type { MemoryHandoffExportV1 } from "../src/memory/artifact-store";

const ui = vi.hoisted(() => ({
  handle: undefined as ((uri: { toString(): string }) => Promise<void>) | undefined,
  selected: undefined as BoundWorkspace | undefined, task: undefined as TaskDetail | undefined,
  actorId: "", localId: "", versionId: "", payload: undefined as MemoryHandoffExportV1 | undefined,
  errors: [] as string[], invoked: [] as Array<{ command: string; request: unknown }>, publish: vi.fn(), cancel: false,
  claim: vi.fn(), report: vi.fn(),
}));
vi.mock("vscode", () => ({
  workspace: { isTrusted: true },
  window: {
    registerUriHandler: (handler: { handleUri(uri: { toString(): string }): Promise<void> }) => { ui.handle = handler.handleUri; return { dispose() {} }; },
    showQuickPick: async (rows: unknown[]) => rows[0],
    showInformationMessage: async () => undefined,
    showErrorMessage: async (message: string) => { ui.errors.push(message); },
    showWarningMessage: async (_message: string, _options: unknown, choice: string) => ui.cancel ? undefined : choice,
  },
  commands: { executeCommand: async (command: string, request: unknown) => { ui.invoked.push({ command, request }); } },
}));
vi.mock("../src/commands/checkpoint-support", () => ({
  selectBoundWorkspace: async () => ui.selected,
  getLocalOnlyRepositoryId: async () => ui.localId,
  createWorkspaceApi: () => ({
    getCurrentActor: async () => ({ id: ui.actorId }), getTask: async () => ui.task,
    getSharedTaskMemory: async () => ({ id: ui.versionId, payload: ui.payload }), publishTaskMemory: ui.publish,
    claimTaskMemoryContinuation: ui.claim, reportTaskMemoryContinuation: ui.report,
  }),
}));
import { registerTaskMemoryLinks } from "../src/commands/task-memory-link";
import { CheckpointStore } from "../src/checkpoints/store";
import { buildTaskMemoryLink, parseTaskMemoryLink } from "../../shared/task-memory/links";
import { createReceivedMemoryCheckpoint } from "../src/memory/received-checkpoint";
import { createContinuationFixture } from "./fixtures/session-memory/continuation-fixture";
import { parseWorkCheckpoint } from "../src/checkpoints/schema";
import { AttemptStore } from "../src/attempts/store";
import { prepareMemoryContinuation } from "../src/memory/continuation";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe("task webpage to local memory continuation", () => {
  it("roundtrips only fixed task actions without tokens or arbitrary commands", () => {
    const input = { action: "continue" as const, serverOrigin: "http://localhost:3000/", projectId: randomUUID(), taskId: randomUUID(), versionId: randomUUID() };
    const uri = buildTaskMemoryLink(input);
    expect(parseTaskMemoryLink(uri)).toEqual(input);
    expect(() => parseTaskMemoryLink(`${uri}&command=arbitrary`)).toThrow("链接无效");
    expect(() => parseTaskMemoryLink(uri.replace("server=http%3A%2F%2Flocalhost%3A3000%2F", "server=http%3A%2F%2Fremote.example%2F"))).toThrow();
    expect(() => parseTaskMemoryLink(`${uri}&task=${randomUUID()}`)).toThrow();
    expect(() => parseTaskMemoryLink(uri.replace("vscode:", "https:"))).toThrow();
    const review = { ...input, action: "review" as const, versionId: undefined, attemptId: randomUUID() };
    expect(parseTaskMemoryLink(buildTaskMemoryLink(review)).attemptId).toBe(review.attemptId);
    expect(() => buildTaskMemoryLink({ ...review, attemptId: undefined })).toThrow();
    expect(() => buildTaskMemoryLink({ ...review, versionId: input.versionId })).toThrow();
    expect(() => buildTaskMemoryLink({ ...input, attemptId: randomUUID() })).toThrow();
  });
  it("creates a receiver-side checkpoint from current task requirements and a verified imported baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-memory-link-")); roots.push(root);
    const f = await createContinuationFixture(root);
    const checkpoint = createReceivedMemoryCheckpoint(f.handoff, f.task, f.repository, f.scope.serverOrigin);
    expect(parseWorkCheckpoint(checkpoint)).toMatchObject({
      taskId: f.task.id, repository: { headSha: f.repository.headSha, dirtyPolicy: "clean-only" },
      session: { provider: "task-memory", sessionId: null, captureMode: "context-only" },
    });
    expect(checkpoint.taskSnapshot.title).toBe(f.task.title);
    expect(checkpoint.handoff.rejectedApproaches).toEqual(f.handoff.material.rejectedApproaches);
    expect(() => createReceivedMemoryCheckpoint(f.handoff, { ...f.task, id: randomUUID() }, f.repository, f.scope.serverOrigin)).toThrow("任务不一致");
    expect(() => createReceivedMemoryCheckpoint(f.handoff, f.task, { ...f.repository, headSha: "b".repeat(40) }, f.scope.serverOrigin)).toThrow("基线不一致");
    expect(() => createReceivedMemoryCheckpoint(f.handoff, f.task, { ...f.repository, dirty: true }, f.scope.serverOrigin)).toThrow("未提交");
  });

  async function bridgeFixture() {
    const root = await mkdtemp(path.join(tmpdir(), "agile-memory-bridge-")); roots.push(root);
    const f = await createContinuationFixture(root);
    ui.errors = []; ui.invoked = []; ui.publish.mockReset(); ui.cancel = false;
    ui.claim.mockReset().mockResolvedValue({ claimId: randomUUID() }); ui.report.mockReset().mockResolvedValue(undefined);
    ui.task = f.task; ui.actorId = f.actorId; ui.localId = f.localId; ui.payload = f.handoff; ui.versionId = randomUUID();
    ui.selected = { folder: { uri: { fsPath: f.workspacePath, toString: () => `file://${f.workspacePath}` } } as vscode.WorkspaceFolder,
      binding: { serverOrigin: f.scope.serverOrigin, projectId: f.scope.projectId, workspaceUri: `file://${f.workspacePath}` } };
    registerTaskMemoryLinks({ globalStorageUri: { fsPath: f.storageRoot }, subscriptions: [] } as unknown as vscode.ExtensionContext);
    return f;
  }

  it("downloads the exact webpage version, prepares a verified local checkpoint and passes fixed identifiers to the existing launcher", async () => {
    const f = await bridgeFixture();
    const uri = buildTaskMemoryLink({ action: "continue", serverOrigin: f.scope.serverOrigin, projectId: f.scope.projectId, taskId: f.scope.taskId, versionId: ui.versionId });
    await ui.handle!({ toString: () => uri });
    expect(ui.errors).toEqual([]);
    expect(ui.invoked).toHaveLength(1);
    expect(ui.invoked[0]).toMatchObject({ command: "agilecampus.continueTaskMemory", request: { taskId: f.scope.taskId, materialId: f.handoff.material.materialId } });
    const records = await new CheckpointStore(f.storageRoot).list(f.scope.serverOrigin, f.scope.projectId);
    expect(records).toHaveLength(1);
    expect(ui.invoked[0].request).toMatchObject({ checkpointId: records[0].manifest.id });
  });

  it("reviews only the ended attempt's exact local session and does not launch or publish", async () => {
    const f = await bridgeFixture();
    const continuation = prepareMemoryContinuation(f.handoff, f.receiver);
    const attempt = await new AttemptStore(f.storageRoot).create({
      checkpointId: f.checkpoint.id, projectId: f.scope.projectId, taskId: f.scope.taskId,
      attemptKind: "single", mode: "context-only", provider: "codex-cli", providerSessionId: f.binding.providerSessionId,
      state: "finished", workdir: f.workspacePath, branch: "main", baseSha: f.repository.headSha,
      parentAttemptId: null, pid: null, exitCode: 0, timedOut: false, memoryInheritance: continuation.inheritance,
    });
    const uri = buildTaskMemoryLink({ action: "review", serverOrigin: f.scope.serverOrigin, projectId: f.scope.projectId, taskId: f.scope.taskId, attemptId: attempt.id });
    await ui.handle!({ toString: () => uri });
    expect(ui.errors).toEqual([]);
    expect(ui.invoked).toEqual([{ command: "agilecampus.extractSessionMemory", request: { taskId: f.scope.taskId, sessionKey: f.binding.sessionKey } }]);
    expect(ui.publish).not.toHaveBeenCalled();
    ui.invoked = [];
    await ui.handle!({ toString: () => buildTaskMemoryLink({ action: "review", serverOrigin: f.scope.serverOrigin, projectId: f.scope.projectId, taskId: f.scope.taskId, attemptId: randomUUID() }) });
    expect(ui.invoked).toEqual([]);
    expect(ui.errors.at(-1)).toContain("没有对应");
    const store = new AttemptStore(f.storageRoot);
    await store.update(attempt.id, { state: "running" });
    await ui.handle!({ toString: () => uri });
    expect(ui.invoked).toEqual([]);
    await store.update(attempt.id, { state: "finished", providerSessionId: "missing-session" });
    await ui.handle!({ toString: () => uri });
    expect(ui.invoked).toEqual([]);
    expect(ui.errors.at(-1)).toContain("无法唯一定位");
  });

  it("claims a tracked webpage request before loading and refuses duplicate claims without launching", async () => {
    const f = await bridgeFixture();
    const requestId = randomUUID();
    const uri = buildTaskMemoryLink({ action: "continue", serverOrigin: f.scope.serverOrigin, projectId: f.scope.projectId, taskId: f.scope.taskId, versionId: ui.versionId, requestId });
    expect(parseTaskMemoryLink(uri).requestId).toBe(requestId);
    await ui.handle!({ toString: () => uri });
    expect(ui.claim).toHaveBeenCalledExactlyOnceWith(f.scope.projectId, f.scope.taskId, requestId, ui.versionId);
    expect(ui.report).toHaveBeenCalledWith(f.scope.projectId, f.scope.taskId, expect.objectContaining({ id: requestId, sequence: 2, state: "checking" }));
    expect(ui.invoked).toHaveLength(1);
    ui.claim.mockRejectedValue(new Error("already claimed"));
    await ui.handle!({ toString: () => uri });
    expect(ui.invoked).toHaveLength(1);
    expect(ui.errors).toContain("already claimed");
  });

  it("shares only an accepted task package after confirmation, and cancels without upload", async () => {
    const f = await bridgeFixture(); await f.artifactStore.saveReceivedExport(f.handoff, f.scope);
    const uri = buildTaskMemoryLink({ action: "publish", serverOrigin: f.scope.serverOrigin, projectId: f.scope.projectId, taskId: f.scope.taskId });
    ui.cancel = true; await ui.handle!({ toString: () => uri });
    expect(ui.publish).not.toHaveBeenCalled();
    ui.cancel = false; await ui.handle!({ toString: () => uri });
    expect(ui.publish).toHaveBeenCalledExactlyOnceWith(f.scope.projectId, f.scope.taskId, f.handoff);
  });

  it("blocks unbound services and changed working files before invoking the launcher", async () => {
    const f = await bridgeFixture();
    const input = { action: "continue" as const, serverOrigin: "https://other.example/", projectId: f.scope.projectId, taskId: f.scope.taskId, versionId: ui.versionId };
    await ui.handle!({ toString: () => buildTaskMemoryLink(input) });
    expect(ui.errors.join(" ")).toContain("相同的服务和项目");
    await writeFile(path.join(f.workspacePath, "search.ts"), "// synthetic concurrent edit\n");
    await ui.handle!({ toString: () => buildTaskMemoryLink({ ...input, serverOrigin: f.scope.serverOrigin }) });
    expect(ui.errors.join(" ")).toContain("未提交改动");
    expect(ui.invoked).toEqual([]);
  });
});
