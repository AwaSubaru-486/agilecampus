import { createHash } from "node:crypto";

/** Stable UUID v5-shaped key for one logical client operation. */
export function stableIdempotencyKey(...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
