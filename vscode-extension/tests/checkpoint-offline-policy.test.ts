import { describe, expect, it } from "vitest";
import { ApiError } from "../src/agilecampus/api-client";
import { mayUseOfflineTaskSnapshot } from "../src/commands/checkpoint-offline-policy";

describe("offline checkpoint fallback policy", () => {
  it.each([null, 500, 503])("allows explicit local fallback for network/service failure %s", (status) => {
    expect(mayUseOfflineTaskSnapshot(new ApiError("offline", status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])("does not turn HTTP %i into offline authorization", (status) => {
    expect(mayUseOfflineTaskSnapshot(new ApiError("request rejected", status))).toBe(false);
  });

  it("fails closed for non-API errors", () => {
    expect(mayUseOfflineTaskSnapshot(new Error("unexpected"))).toBe(false);
  });
});
