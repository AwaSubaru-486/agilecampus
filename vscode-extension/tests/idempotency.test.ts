import { describe, expect, it } from "vitest";
import { stableIdempotencyKey } from "../src/checkpoints/idempotency";

describe("stable operation idempotency keys", () => {
  it("reuses a key for the same logical operation and separates different operations", () => {
    const first = stableIdempotencyKey("https://agile.example/", "project", "task", "checkpoint", "user", "recipient");
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableIdempotencyKey("https://agile.example/", "project", "task", "checkpoint", "user", "recipient")).toBe(first);
    expect(stableIdempotencyKey("https://agile.example/", "project", "task", "checkpoint", "user", "other-recipient")).not.toBe(first);
  });
});
