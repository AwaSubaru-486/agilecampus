import type { ContinuationProgress } from "../../../shared/task-memory/continuation-status";
import type { ReceiptAddress, ReceiptOutbox } from "./receipt-outbox";
export type ContinuationObserver = (progress: ContinuationProgress) => Promise<void>;

/** Serialize callbacks and retry the same sequence after an ambiguous network response. */
export function createContinuationReporter(send: (sequence: number, progress: ContinuationProgress) => Promise<void>): ContinuationObserver {
  let sequence = 1;
  let pending: ContinuationProgress | undefined;
  let tail = Promise.resolve();
  async function flush() {
    if (!pending) return;
    try { await send(sequence + 1, pending); }
    catch { await send(sequence + 1, pending); }
    sequence++; pending = undefined;
  }
  return (progress) => {
    const run = async () => { await flush(); pending = progress; await flush(); };
    tail = tail.then(run, run);
    return tail;
  };
}

/** Persist every observed transition before attempting transport; later callbacks cannot discard an offline predecessor. */
export async function createDurableContinuationReporter(outbox: ReceiptOutbox, address: ReceiptAddress, send: (sequence: number, progress: ContinuationProgress) => Promise<void>): Promise<ContinuationObserver> {
  await outbox.open(address);
  let tail = Promise.resolve();
  return (progress) => {
    const run = async () => { await outbox.append(address, progress); await outbox.flush(address, send); };
    tail = tail.then(run, run);
    return tail;
  };
}
