import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import { canTransitionContinuation, type ContinuationProgress, type ContinuationState } from "../../../shared/task-memory/continuation-status";
import { GitRefLockStore } from "../attempts/git-ref-lock";
import { stableStringify } from "./input-snapshot";
import { validateServerUrl } from "../agilecampus/api-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
export type ReceiptAddress = {
  serverOrigin: string; projectId: string; taskId: string; requestId: string; versionId: string;
  claimId: string; actorScope: string; workspaceScope: string;
};
type Event = { sequence: number; progress: ContinuationProgress };
type Outbox = { schemaVersion: 1; address: ReceiptAddress; ackedSequence: number; ackedState: ContinuationState; ackedAttemptId?: string; events: Event[] };

/** Private, atomic local queue. Disk contains references and status only, never PATs or conversations. */
export class ReceiptOutbox {
  private readonly locks: GitRefLockStore;
  constructor(private readonly root: string) { this.locks = new GitRefLockStore(root); }

  async open(address: ReceiptAddress): Promise<void> {
    validateAddress(address);
    await this.mutate(address.requestId, async () => {
      const existing = await this.read(address.requestId);
      if (existing) { this.sameAddress(existing, address); return; }
      await this.write({ schemaVersion: 1, address, ackedSequence: 1, ackedState: "received", events: [] });
    });
  }

  async append(address: ReceiptAddress, progress: ContinuationProgress): Promise<void> {
    await this.mutate(address.requestId, async () => {
      const record = await this.require(address);
      const last = record.events.at(-1);
      const state = last?.progress.state ?? record.ackedState;
      const attemptId = last?.progress.attemptId ?? record.ackedAttemptId;
      if (last && stableStringify(last.progress) === stableStringify(progress)) return;
      if (!canTransitionContinuation(state, progress.state)) throw new Error("本地接续回执顺序无效，未覆盖原记录");
      if (record.events.length >= 256) throw new Error("待同步回执超过本机上限，请先恢复同步");
      if (attemptId && progress.attemptId && attemptId !== progress.attemptId) throw new Error("回执不能更换执行记录");
      record.events.push({ sequence: (last?.sequence ?? record.ackedSequence) + 1, progress: { ...progress } });
      parseOutbox(record);
      await this.write(record);
    });
  }

  async flush(address: ReceiptAddress, send: (sequence: number, progress: ContinuationProgress) => Promise<void>): Promise<number> {
    validateAddress(address);
    // The send lock is independent of short disk mutations, so new terminal events can be persisted while offline.
    const lock = await this.locks.tryAcquire(`memory-receipt-send:${address.requestId}`, { kind: "session-memory-write", hostPid: process.pid }, deadOwner);
    if (!lock) return 0;
    let sent = 0;
    try {
      while (true) {
        const record = await this.require(address);
        const event = record.events[0];
        if (!event) return sent;
        try { await send(event.sequence, event.progress); }
        catch { await send(event.sequence, event.progress); }
        await this.mutate(address.requestId, async () => {
          const current = await this.require(address);
          if (stableStringify(current.events[0]) !== stableStringify(event)) throw new Error("待发送回执已变化，未跳过原序号");
          current.ackedSequence = event.sequence; current.ackedState = event.progress.state;
          current.ackedAttemptId = event.progress.attemptId ?? current.ackedAttemptId;
          current.events.shift(); await this.write(current);
        });
        sent++;
      }
    } finally { await lock.release(); }
  }

  async pending(scope: Pick<ReceiptAddress, "serverOrigin" | "projectId" | "workspaceScope"> & { actorScope?: string }): Promise<ReceiptAddress[]> {
    const result = await this.scanPending(scope);
    if (result.unreadable) throw new Error("存在无法读取的本机回执文件，原文件已保留");
    return result.addresses;
  }

  async scanPending(scope: Pick<ReceiptAddress, "serverOrigin" | "projectId" | "workspaceScope"> & { actorScope?: string }): Promise<{ addresses: ReceiptAddress[]; unreadable: number }> {
    const directory = await this.directory();
    const result: ReceiptAddress[] = [];
    let unreadable = 0;
    for (const file of await readdir(directory)) {
      if (!file.endsWith(".json") || !UUID.test(file.slice(0, -5))) continue;
      let record: Outbox | undefined;
      try { record = await this.read(file.slice(0, -5)); } catch { unreadable++; continue; }
      if (record?.events.length && record.address.serverOrigin === scope.serverOrigin && record.address.projectId === scope.projectId &&
          record.address.workspaceScope === scope.workspaceScope && (!scope.actorScope || record.address.actorScope === scope.actorScope)) result.push(record.address);
    }
    return { addresses: result, unreadable };
  }

  private sameAddress(record: Outbox, address: ReceiptAddress) {
    if (stableStringify(record.address) !== stableStringify(address)) throw new Error("接续回执属于其他账号、工作区或领取凭据");
  }
  private async require(address: ReceiptAddress) {
    validateAddress(address);
    const record = await this.read(address.requestId);
    if (!record) throw new Error("本地接续回执不存在");
    this.sameAddress(record, address); return record;
  }
  private async mutate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (!UUID.test(id)) throw new Error("接续请求标识无效");
    for (let attempt = 0; attempt < 100; attempt++) {
      const lock = await this.locks.tryAcquire(`memory-receipt-disk:${id}`, { kind: "session-memory-write", hostPid: process.pid }, deadOwner);
      if (lock) { try { return await operation(); } finally { await lock.release(); } }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("本地回执正由其他窗口更新，请稍后重试");
  }
  private async directory() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const target of [this.root, path.join(this.root, "session-memory"), path.join(this.root, "session-memory", "continuation-outbox")]) {
      await mkdir(target, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      const stat = await lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("回执存储目录不安全");
    }
    return path.join(this.root, "session-memory", "continuation-outbox");
  }
  private async read(id: string): Promise<Outbox | undefined> {
    const file = path.join(await this.directory(), `${id}.json`);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error("回执文件无效");
      const bytes = await readFile(file);
      if (bytes.length > 128 * 1024) throw new Error("回执文件超过上限");
      const record = parseOutbox(JSON.parse(bytes.toString("utf8")));
      if (record.address.requestId !== id) throw new Error("回执请求标识不匹配");
      return record;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  private async write(record: Outbox) {
    parseOutbox(record);
    const file = path.join(await this.directory(), `${record.address.requestId}.json`);
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
}

function validateAddress(value: ReceiptAddress) {
  if (!value || Object.keys(value).sort().join(",") !== "actorScope,claimId,projectId,requestId,serverOrigin,taskId,versionId,workspaceScope" ||
      ![value.projectId, value.taskId, value.requestId, value.versionId, value.claimId].every((id) => typeof id === "string" && UUID.test(id)) ||
      ![value.actorScope, value.workspaceScope].every((hash) => typeof hash === "string" && HASH.test(hash)) ||
      typeof value.serverOrigin !== "string" || validateServerUrl(value.serverOrigin).toString() !== value.serverOrigin) throw new Error("回执绑定格式无效");
}
function parseOutbox(value: unknown): Outbox {
  const record = value as Outbox;
  if (!record || Object.keys(record).some((key) => !["schemaVersion", "address", "ackedSequence", "ackedState", "ackedAttemptId", "events"].includes(key)) ||
      record.schemaVersion !== 1 || !Number.isSafeInteger(record.ackedSequence) || record.ackedSequence < 1 ||
      !["received", "checking", "awaiting_confirmation", "launching", "running", "finished", "failed", "cancelled", "unknown"].includes(record.ackedState) ||
      record.ackedAttemptId !== undefined && !UUID.test(record.ackedAttemptId) || !Array.isArray(record.events) || record.events.length > 256) throw new Error("本地回执格式无效");
  validateAddress(record.address);
  let state = record.ackedState, attemptId = record.ackedAttemptId;
  record.events.forEach((event, index) => {
    const progress = event?.progress;
    if (!event || Object.keys(event).some((key) => !["sequence", "progress"].includes(key)) || event.sequence !== record.ackedSequence + index + 1 ||
        !progress || Object.keys(progress).some((key) => !["state", "attemptId", "sessionConfirmed"].includes(key)) || !canTransitionContinuation(state, progress.state) ||
        progress.attemptId !== undefined && !UUID.test(progress.attemptId) || progress.sessionConfirmed !== undefined && typeof progress.sessionConfirmed !== "boolean" ||
        ["launching", "running", "finished", "unknown"].includes(progress.state) && !progress.attemptId ||
        progress.state === "running" && progress.sessionConfirmed !== true || attemptId && progress.attemptId && attemptId !== progress.attemptId) throw new Error("本地回执顺序或真实会话依据无效");
    state = progress.state; attemptId = progress.attemptId ?? attemptId;
  });
  return record;
}
function deadOwner(record: { hostPid: number }) {
  try { process.kill(record.hostPid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
