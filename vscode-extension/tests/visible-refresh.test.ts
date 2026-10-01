import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_INTERVAL_MS, VisibleRefreshController, refreshBackoffMs } from "../src/sync/visible-refresh";

afterEach(() => vi.useRealTimers());

describe("visible refresh controller", () => {
  it("polls every 15 seconds only while visible and enabled", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => ({ ok: true, status: null }));
    const controller = new VisibleRefreshController(refresh);

    controller.setEnabled(true);
    controller.setVisible(true);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    controller.setVisible(false);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("uses bounded 15/30/60 second backoff with jitter and resets after success", async () => {
    expect(refreshBackoffMs(1, 0)).toBe(12_000);
    expect(refreshBackoffMs(2, 0.5)).toBe(30_000);
    expect(refreshBackoffMs(3, 1)).toBe(72_000);

    vi.useFakeTimers();
    let attempt = 0;
    const refresh = vi.fn(async () => {
      attempt += 1;
      return attempt < 3 ? { ok: false, status: 503 } : { ok: true, status: null };
    });
    const controller = new VisibleRefreshController(refresh, {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
      random: () => 0.5,
    });
    controller.setEnabled(true);
    controller.setVisible(true);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(4);
    controller.dispose();
  });

  it("pauses automatic retries after 401 until an explicit refresh", async () => {
    vi.useFakeTimers();
    let status = 401;
    const refresh = vi.fn(async () => ({ ok: status === null, status }));
    const controller = new VisibleRefreshController(refresh);
    controller.setEnabled(true);
    controller.setVisible(true);

    await controller.refreshNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    status = null;
    await controller.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it("serializes manual refresh behind an active poll and cancels timers on dispose", async () => {
    vi.useFakeTimers();
    const resolveFirst: Array<(value: { ok: true; status: null }) => void> = [];
    let active = 0;
    let maxActive = 0;
    const refresh = vi.fn(() => new Promise<{ ok: true; status: null }>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      resolveFirst.push((value) => { active -= 1; resolve(value); });
    }));
    const controller = new VisibleRefreshController(refresh);
    controller.setEnabled(true);
    controller.setVisible(true);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    const manual = controller.refreshNow();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    resolveFirst[0]({ ok: true, status: null });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(maxActive).toBe(1);
    resolveFirst[1]({ ok: true, status: null });
    await manual;

    controller.dispose();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not start a queued request after disposal", async () => {
    let resolvePoll!: (value: { ok: true; status: null }) => void;
    const refresh = vi.fn(() => new Promise<{ ok: true; status: null }>((resolve) => { resolvePoll = resolve; }));
    const controller = new VisibleRefreshController(refresh);
    controller.setEnabled(true);
    controller.setVisible(true);
    const manual = controller.refreshNow();
    await Promise.resolve();
    controller.dispose();
    resolvePoll({ ok: true, status: null });
    await manual;
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
