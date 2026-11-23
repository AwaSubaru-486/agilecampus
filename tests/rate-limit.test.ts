import { beforeEach, describe, expect, it } from "vitest";
import { activeSlots, rateLimit, releaseSlot, resetAllRateLimits, resetRateLimit, tryAcquireSlot } from "@/lib/rate-limit";

beforeEach(() => { resetAllRateLimits(); });

describe("固定窗口限流", () => {
  it("窗口内允许到上限，之后拒绝并给出重试秒数", () => {
    expect(rateLimit("k", 2, 10_000, 0).ok).toBe(true);
    expect(rateLimit("k", 2, 10_000, 1).ok).toBe(true);
    const blocked = rateLimit("k", 2, 10_000, 2);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(10);
    expect(rateLimit("k", 2, 10_000, 10_000).ok).toBe(true);
  });

  it("不同 key 互不影响，reset 只清一个 key", () => {
    rateLimit("a", 1, 10_000, 0);
    expect(rateLimit("a", 1, 10_000, 1).ok).toBe(false);
    expect(rateLimit("b", 1, 10_000, 1).ok).toBe(true);
    resetRateLimit("a");
    expect(rateLimit("a", 1, 10_000, 2).ok).toBe(true);
  });
});

describe("并发闸门", () => {
  it("同时只允许指定数量的请求", () => {
    expect(tryAcquireSlot("s", 2)).toBe(true);
    expect(tryAcquireSlot("s", 2)).toBe(true);
    expect(tryAcquireSlot("s", 2)).toBe(false);
    releaseSlot("s");
    expect(activeSlots("s")).toBe(1);
    expect(tryAcquireSlot("s", 2)).toBe(true);
    releaseSlot("s");
    releaseSlot("s");
    expect(activeSlots("s")).toBe(0);
  });
});
