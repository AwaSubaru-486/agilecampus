import { describe, expect, it, vi } from "vitest";
import { createContinuationReporter } from "../src/memory/continuation-reporter";
describe("continuation receipt transport", () => {
  it("serializes concurrent callbacks and retries an ambiguous response with the same sequence", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValue(undefined);
    const report = createContinuationReporter(send);
    await Promise.all([report({ state: "checking" }), report({ state: "awaiting_confirmation" })]);
    expect(send.mock.calls.map(([sequence, event]) => [sequence, event.state])).toEqual([[2, "checking"], [2, "checking"], [3, "awaiting_confirmation"]]);
  });
  it("recovers the pending receipt before a later callback after a connection outage", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    const report = createContinuationReporter(send);
    await expect(report({ state: "checking" })).rejects.toThrow("offline");
    send.mockResolvedValue(undefined);
    await report({ state: "awaiting_confirmation" });
    expect(send.mock.calls.map(([sequence, event]) => [sequence, event.state])).toEqual([[2, "checking"], [2, "checking"], [2, "checking"], [3, "awaiting_confirmation"]]);
  });
});
