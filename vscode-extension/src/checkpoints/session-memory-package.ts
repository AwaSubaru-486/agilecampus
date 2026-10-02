import { createHash } from "node:crypto";
import { parseSessionMemoryPackageV1, type SessionMemoryValidationContext } from "../../../shared/session-memory";

export function parseSessionMemoryPackage(value: unknown, context: SessionMemoryValidationContext = {}) {
  return parseSessionMemoryPackageV1(value, (bytes) => createHash("sha256").update(bytes).digest("hex"), context);
}
