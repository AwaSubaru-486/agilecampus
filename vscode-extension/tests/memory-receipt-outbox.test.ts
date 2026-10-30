import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptOutbox, type ReceiptAddress } from "../src/memory/receipt-outbox";
import { createDurableContinuationReporter } from "../src/memory/continuation-reporter";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-receipt-")); roots.push(root);
  const address: ReceiptAddress = { serverOrigin: "http://localhost:3000/", projectId: randomUUID(), taskId: randomUUID(),
    requestId: randomUUID(), versionId: randomUUID(), claimId: randomUUID(), actorScope: "a".repeat(64), workspaceScope: "b".repeat(64) };
  const store = new ReceiptOutbox(root); await store.open(address);
  const file = path.join(root, "session-memory", "continuation-outbox", `${address.requestId}.json`);
  return { root, store, address, file };
}

describe("durable continuation receipt outbox", () => {
  it("persists a real running and terminal callback while offline and replays in order from a new instance", async () => {
    const f = await fixture(); const attemptId = randomUUID();
    const send = vi.fn().mockResolvedValue(undefined);
    const report = await createDurableContinuationReporter(f.store, f.address, send);
    await report({ state: "checking" }); await report({ state: "awaiting_confirmation" }); await report({ state: "launching", attemptId });
    send.mockRejectedValue(new Error("offline"));
    await expect(report({ state: "running", attemptId, sessionConfirmed: true })).rejects.toThrow("offline");
    await expect(report({ state: "finished", attemptId })).rejects.toThrow("offline");
    const restarted = new ReceiptOutbox(f.root);
    expect(await restarted.pending(f.address)).toEqual([f.address]);
    const replay = vi.fn().mockResolvedValue(undefined);
    expect(await restarted.flush(f.address, replay)).toBe(2);
    expect(replay.mock.calls).toEqual([[5, { state: "running", attemptId, sessionConfirmed: true }], [6, { state: "finished", attemptId }]]);
    expect(await restarted.pending(f.address)).toEqual([]);
    expect(await restarted.flush(f.address, replay)).toBe(0);
    expect((await stat(f.file)).mode & 0o777).toBe(0o600);
    expect(await readFile(f.file, "utf8")).not.toContain("ac_");
  });

  it("retries an ambiguous response with the same sequence and survives a restart before local acknowledgment", async () => {
    const f = await fixture(); await f.store.append(f.address, { state: "checking" });
    let accepted = 0;
    // Model a server accepting the receipt but both HTTP responses being lost.
    await expect(f.store.flush(f.address, async (sequence) => { accepted = sequence; throw new Error("response lost"); })).rejects.toThrow("response lost");
    expect(accepted).toBe(2);
    const send = vi.fn(async (sequence: number) => { expect(sequence).toBe(accepted); });
    await new ReceiptOutbox(f.root).flush(f.address, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("allows a terminal event to be written during a slow send and prevents a second sender from overtaking it", async () => {
    const f = await fixture(); await f.store.append(f.address, { state: "checking" });
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sent: string[] = [];
    const first = f.store.flush(f.address, async (_sequence, event) => { sent.push(event.state); started(); await gate; });
    await entered;
    try {
      await new ReceiptOutbox(f.root).append(f.address, { state: "failed" });
      expect(await new ReceiptOutbox(f.root).flush(f.address, async () => { throw new Error("must not send concurrently"); })).toBe(0);
    } finally { release(); }
    await first;
    expect(sent).toEqual(["checking", "failed"]);
  });

  it("isolates actor, workspace, service, project and claim without replacing the queued event", async () => {
    const f = await fixture(); await f.store.append(f.address, { state: "checking" });
    for (const wrong of [{ actorScope: "c".repeat(64) }, { workspaceScope: "d".repeat(64) }, { serverOrigin: "https://example.test/" }, { projectId: randomUUID() }]) {
      expect(await f.store.pending({ ...f.address, ...wrong })).toEqual([]);
      await expect(f.store.flush({ ...f.address, ...wrong }, async () => undefined)).rejects.toThrow("其他账号");
    }
    await expect(f.store.open({ ...f.address, claimId: randomUUID() })).rejects.toThrow("领取凭据");
    expect(await f.store.pending(f.address)).toEqual([f.address]);
  });

  it("rejects fabricated running status, reordered events and another attempt", async () => {
    const f = await fixture(); const attemptId = randomUUID();
    await f.store.append(f.address, { state: "checking" });
    await expect(f.store.append(f.address, { state: "finished", attemptId })).rejects.toThrow("顺序");
    await f.store.append(f.address, { state: "awaiting_confirmation" });
    await f.store.append(f.address, { state: "launching", attemptId });
    await expect(f.store.append(f.address, { state: "running", attemptId })).rejects.toThrow("真实会话");
    await expect(f.store.append(f.address, { state: "running", attemptId: randomUUID(), sessionConfirmed: true })).rejects.toThrow("更换执行记录");
    const send = vi.fn().mockResolvedValue(undefined);
    await f.store.flush(f.address, send);
    expect(send.mock.calls.map(([sequence]) => sequence)).toEqual([2, 3, 4]);
  });

  it("refuses corrupted or symlinked files without sending their contents", async () => {
    const f = await fixture(); await f.store.append(f.address, { state: "checking" });
    const value = JSON.parse(await readFile(f.file, "utf8")); value.events[0].sequence = 50;
    await writeFile(f.file, JSON.stringify(value));
    const send = vi.fn();
    await expect(f.store.flush(f.address, send)).rejects.toThrow("顺序"); expect(send).not.toHaveBeenCalled();
    await rm(f.file);
    const external = path.join(f.root, "external.json"); await writeFile(external, "{}"); await symlink(external, f.file);
    await expect(f.store.pending(f.address)).rejects.toThrow("文件无效");
    expect(await readFile(external, "utf8")).toBe("{}");
  });
});
