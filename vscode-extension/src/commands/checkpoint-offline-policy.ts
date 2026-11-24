import { ApiError } from "../agilecampus/api-client";

export function mayUseOfflineTaskSnapshot(error: unknown): boolean {
  return error instanceof ApiError && (error.status === null || error.status >= 500);
}
