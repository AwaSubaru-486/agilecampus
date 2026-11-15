import { describe, expect, it } from "vitest";
import { continuationTiming, type ContinuationView } from "../shared/task-memory/continuation-status";

const at = Date.parse("2026-11-16T10:00:00Z");
const record: ContinuationView = {
  id: "request", versionId: "version", state: "waiting", sequence: 0, attemptId: null,
  events: [], createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(),
};

describe("接续进度提示", () => {
  it("仅未领取的请求满十分钟后显示过期", () => {
    expect(continuationTiming(record, at + 599_999)).toEqual({ waitingExpired: false, receiptQuiet: false });
    expect(continuationTiming(record, at + 600_000)).toEqual({ waitingExpired: true, receiptQuiet: false });
  });
  it("已接收的请求只提示未收到回执，不标记失败或放开重复启动", () => {
    const running = { ...record, state: "running" as const, updatedAt: new Date(at + 1000).toISOString() };
    expect(continuationTiming(running, at + 120_999).receiptQuiet).toBe(false);
    expect(continuationTiming(running, at + 121_000)).toEqual({ waitingExpired: false, receiptQuiet: true });
    expect(running.state).toBe("running");
  });
  it("已结束或不存在的请求不显示失联提示", () => {
    expect(continuationTiming({ ...record, state: "finished" }, at + 600_000).receiptQuiet).toBe(false);
    expect(continuationTiming(null, at).receiptQuiet).toBe(false);
  });
});
