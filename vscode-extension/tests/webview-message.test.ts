import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/views/webview-message";

const taskId = "60000000-0000-4000-8000-000000000001";
const sessionKey = "60000000-0000-4000-8000-000000000002";

describe("session memory webview messages", () => {
  it("accepts scoped session actions with valid identifiers", () => {
    expect(parseWebviewMessage({ type: "bindSession", taskId })).toEqual({ type: "bindSession", taskId });
    expect(parseWebviewMessage({ type: "openSessionRecord", taskId, sessionKey })).toEqual({ type: "openSessionRecord", taskId, sessionKey });
    expect(parseWebviewMessage({ type: "stopSessionCapture", taskId, sessionKey })).toEqual({ type: "stopSessionCapture", taskId, sessionKey });
  });

  it("rejects arbitrary paths, provider ids, and malformed session keys", () => {
    expect(parseWebviewMessage({ type: "bindSession", taskId, providerSessionId: "raw-native-id" })).toBeNull();
    expect(parseWebviewMessage({ type: "openSessionRecord", taskId, sessionKey: "../../secrets" })).toBeNull();
    expect(parseWebviewMessage({ type: "stopSessionCapture", taskId: "/work", sessionKey })).toBeNull();
  });
});
