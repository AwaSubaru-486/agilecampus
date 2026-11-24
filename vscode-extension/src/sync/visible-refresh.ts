export type RefreshResult = {
  ok: boolean;
  status: number | null;
  stale?: boolean;
};

type TimerHandle = ReturnType<typeof setTimeout>;
type TimerApi = {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  random(): number;
};

const defaultTimerApi: TimerApi = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
  random: () => Math.random(),
};

export const REFRESH_INTERVAL_MS = 15_000;

export function refreshBackoffMs(failureCount: number, random = Math.random()): number {
  const base = failureCount <= 1 ? 15_000 : failureCount === 2 ? 30_000 : 60_000;
  const boundedRandom = Math.min(1, Math.max(0, random));
  return Math.round(base * (0.8 + boundedRandom * 0.4));
}

/** Visible-view polling for idempotent GET refreshes. It never retries writes. */
export class VisibleRefreshController {
  private timer: TimerHandle | undefined;
  private visible = false;
  private enabled = false;
  private disposed = false;
  private authRequired = false;
  private failureCount = 0;
  private inFlight: Promise<RefreshResult> | undefined;
  private manualInFlight: Promise<RefreshResult> | undefined;

  constructor(
    private readonly refresh: () => Promise<RefreshResult>,
    private readonly timers: TimerApi = defaultTimerApi,
  ) {}

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) this.clearTimer();
    else this.schedule(REFRESH_INTERVAL_MS);
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clearTimer();
    else this.schedule(REFRESH_INTERVAL_MS);
  }

  refreshNow(forceAfterCurrent = false): Promise<RefreshResult> {
    if (this.disposed) return Promise.resolve({ ok: false, status: null });
    if (this.manualInFlight) {
      return forceAfterCurrent
        ? this.manualInFlight.then(() => this.refreshNow())
        : this.manualInFlight;
    }
    this.authRequired = false;
    this.failureCount = 0;
    this.clearTimer();

    const operation = (async () => {
      // A manual refresh requested during polling runs immediately after it, never in parallel.
      if (this.inFlight) {
        const active = this.inFlight;
        await active;
        if (this.inFlight === active) this.inFlight = undefined;
      }
      if (this.disposed) return { ok: false, status: null };
      const result = await this.runOnce();
      this.scheduleFromResult(result);
      return result;
    })();
    this.manualInFlight = operation;
    void operation.finally(() => {
      if (this.manualInFlight === operation) this.manualInFlight = undefined;
    });
    return operation;
  }

  dispose(): void {
    this.disposed = true;
    this.visible = false;
    this.enabled = false;
    this.clearTimer();
  }

  private scheduleFromResult(result: RefreshResult): void {
    if (result.status === 401) {
      this.authRequired = true;
      this.clearTimer();
      return;
    }
    if (result.stale) {
      this.schedule(REFRESH_INTERVAL_MS);
      return;
    }
    if (result.ok) {
      this.failureCount = 0;
      this.schedule(REFRESH_INTERVAL_MS);
      return;
    }
    this.failureCount += 1;
    this.schedule(refreshBackoffMs(this.failureCount, this.timers.random()));
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (this.disposed || !this.visible || !this.enabled || this.authRequired) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      void this.runOnce().then((result) => this.scheduleFromResult(result));
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private runOnce(): Promise<RefreshResult> {
    if (this.inFlight) return this.inFlight;
    const operation = Promise.resolve().then(this.refresh).catch(() => ({ ok: false, status: null }));
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined;
    });
    return operation;
  }
}
