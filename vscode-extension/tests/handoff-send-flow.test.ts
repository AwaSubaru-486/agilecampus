import { describe, expect, it } from "vitest";
import { runConfirmedHandoff } from "../src/commands/handoff-send-flow";

describe("confirmed handoff send ordering", () => {
  it("does not persist a pending mapping or send when the user cancels", async () => {
    const events: string[] = [];
    const result = await runConfirmedHandoff(false, async () => { events.push("persist"); }, async () => {
      events.push("send");
      return "handoff-id";
    });
    expect(result).toEqual({ cancelled: true });
    expect(events).toEqual([]);
  });

  it("persists the stable request mapping before sending after confirmation", async () => {
    const events: string[] = [];
    const result = await runConfirmedHandoff(true, async () => { events.push("persist"); }, async () => {
      events.push("send");
      return "handoff-id";
    });
    expect(result).toEqual({ cancelled: false, value: "handoff-id" });
    expect(events).toEqual(["persist", "send"]);
  });
});
