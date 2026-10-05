import type { ProjectHandoffMember } from "../agilecampus/api-client";

export type HandoffState = "offered" | "accepted" | "declined" | "withdrawn" | "superseded";

export function recipientCanReadCheckpoint(
  visibility: "project" | "assignee",
  recipient: ProjectHandoffMember,
  taskAssigneeId: string | null,
): boolean {
  return visibility === "project" || recipient.userId === taskAssigneeId || recipient.role === "admin";
}

/** Only a closed, unsuccessful offer can be re-issued from the same checkpoint. */
export function canReissueHandoff(state: HandoffState): boolean {
  return state === "declined" || state === "withdrawn";
}
