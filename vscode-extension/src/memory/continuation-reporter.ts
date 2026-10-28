import type { ContinuationProgress } from "../../../shared/task-memory/continuation-status";
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
