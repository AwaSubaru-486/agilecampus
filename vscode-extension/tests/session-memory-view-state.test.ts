import { describe, expect, it } from "vitest";
import { createSessionMemoryViewState } from "../src/session-memory/view-state";
import type { SessionMemoryBindingView } from "../src/types";

const base: SessionMemoryBindingView = {
  sessionKey: "60000000-0000-4000-8000-000000000002", provider: "codex", recording: true,
  eventCount: 0, latestSequence: 0, lastSavedAt: null, hookConfigured: false,
};

describe("session memory status contract", () => {
  it("distinguishes unbound, linked, waiting, recorded, and stopped from persisted facts", () => {
    expect(createSessionMemoryViewState("task", []).status).toBe("unbound");
    expect(createSessionMemoryViewState("task", [base])).toMatchObject({ status: "linked", detail: "已关联；本机记录尚未启用。" });
    expect(createSessionMemoryViewState("task", [{ ...base, hookConfigured: true }]).status).toBe("waiting");
    expect(createSessionMemoryViewState("task", [{ ...base, hookConfigured: true, eventCount: 1, latestSequence: 1 }]).status).toBe("recorded");
    expect(createSessionMemoryViewState("task", [{ ...base, recording: false }]).status).toBe("stopped");
  });

  it("does not expose provider-native session ids in the webview model", () => {
    const state = createSessionMemoryViewState("task", [base]);
    expect(JSON.stringify(state)).not.toContain("providerSessionId");
    expect(JSON.stringify(state)).not.toContain("codex-session");
  });
});
