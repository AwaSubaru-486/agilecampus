import type { ClassValue } from "./types";

/**
 * Small class joiner kept local so the UI layer does not add a styling runtime.
 * Falsy values are intentionally ignored; callers can pass conditional classes
 * without pulling business logic into the primitive components.
 */
export function cx(...values: ClassValue[]): string {
  return values
    .flatMap((value) => {
      if (!value) return [];
      if (typeof value === "string" || typeof value === "number") return [String(value)];
      if (Array.isArray(value)) return [cx(...value)];
      return Object.entries(value)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([name]) => name);
    })
    .filter(Boolean)
    .join(" ");
}
