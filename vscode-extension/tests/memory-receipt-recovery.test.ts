import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundWorkspace } from "../src/commands/checkpoint-support";

const ui = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void>>(), selected: undefined as BoundWorkspace | undefined,
  trusted: true, actorId: "", infos: [] as string[], errors: [] as string[],
  actor: vi.fn(), send: vi.fn(),
}));
vi.mock("vscode", () => ({
  workspace: { get isTrusted() { return ui.trusted; }, workspaceFolders: [] },
  ProgressLocation: { Notification: 1 },
  commands: { registerCommand: (id: string, action: () => Promise<void>) => { ui.commands.set(id, action); return { dispose() {} }; } },
  window: {
    withProgress: async (_options: unknown, action: () => Promise<unknown>) => action(),
    showInformationMessage: async (text: string) => { ui.infos.push(text); },
    showErrorMessage: async (text: string) => { ui.errors.push(text); },
  },
}));
vi.mock("../src/commands/checkpoint-support", () => ({
  selectBoundWorkspace: async () => ui.selected,
  createWorkspaceApi: () => ({ getCurrentActor: ui.actor, reportTaskMemoryContinuation: ui.send }),
}));

import { registerMemoryReceiptRecovery } from "../src/commands/memory-receipt-recovery";
import { ReceiptOutbox } from "../src/memory/receipt-outbox";
import { sha256, workspaceScopeHash } from "../src/memory/input-snapshot";

const roots: string[] = [];
const disposables: vscode.Disposable[] = [];
beforeEach(() => { ui.commands.clear(); ui.trusted = true; ui.infos = []; ui.errors = []; ui.actor.mockReset(); ui.send.mockReset().mockResolvedValue(undefined); });
afterEach(async () => { for (const item of disposables.splice(0)) item.dispose(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-recovery-command-")); roots.push(root);
  ui.actorId = randomUUID(); ui.actor.mockResolvedValue({ id: ui.actorId });
  const address = { serverOrigin: "http://localhost:3000/", projectId: randomUUID(), taskId: randomUUID(), requestId: randomUUID(), versionId: randomUUID(), claimId: randomUUID(),
    actorScope: sha256(`agilecampus-actor-v1\0http://localhost:3000/\0${ui.actorId}`), workspaceScope: await workspaceScopeHash(root) };
  const store = new ReceiptOutbox(root); await store.open(address); await store.append(address, { state: "checking" });
  ui.selected = { folder: { uri: { fsPath: root, toString: () => `file://${root}` } } as vscode.WorkspaceFolder,
    binding: { serverOrigin: address.serverOrigin, projectId: address.projectId, workspaceUri: `file://${root}` } };
  const context = { globalStorageUri: { fsPath: root }, subscriptions: [] as vscode.Disposable[], workspaceState: { get: () => undefined } } as unknown as vscode.ExtensionContext;
  registerMemoryReceiptRecovery(context);
  // Exercise the same recovery function through the command; keep background timers from racing the assertions.
  context.subscriptions[0].dispose(); disposables.push(...context.subscriptions);
  const retry = () => ui.commands.get("agilecampus.retryMemoryReceipts")!();
  return { store, address, retry };
}

describe("receipt recovery command identity checks", () => {
  it("retries the original claim and sequence for the bound actor", async () => {
    const f = await fixture(); await f.retry();
    expect(ui.send).toHaveBeenCalledExactlyOnceWith(f.address.projectId, f.address.taskId, { id: f.address.requestId, claimId: f.address.claimId, sequence: 2, state: "checking" });
    expect(await f.store.pending(f.address)).toEqual([]);
    expect(ui.infos.at(-1)).toContain("同步完成");
  });
  it("does not send another account's queued claims after switching tokens", async () => {
    const f = await fixture(); ui.actor.mockResolvedValue({ id: randomUUID() });
    await f.retry();
    expect(ui.send).not.toHaveBeenCalled();
    expect(await f.store.pending(f.address)).toEqual([f.address]);
  });
  it("does not read another project's queue or use an untrusted workspace", async () => {
    const f = await fixture(); ui.selected!.binding.projectId = randomUUID();
    await f.retry(); expect(ui.actor).not.toHaveBeenCalled(); expect(ui.send).not.toHaveBeenCalled();
    ui.trusted = false; await f.retry(); expect(ui.errors.at(-1)).toContain("信任当前工作区");
    expect(await f.store.pending(f.address)).toEqual([f.address]);
  });
  it("leaves offline receipts intact and succeeds on a later retry", async () => {
    const f = await fixture(); ui.send.mockRejectedValue(new Error("offline"));
    await f.retry(); expect(ui.infos.at(-1)).toContain("仍有 1 个请求待同步");
    ui.send.mockResolvedValue(undefined); await f.retry();
    expect(await f.store.pending(f.address)).toEqual([]);
    expect(ui.errors).toEqual([]);
  });
});
