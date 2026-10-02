import { describe, expect, it } from "vitest";
import { canReissueHandoff, recipientCanReadCheckpoint } from "../src/commands/handoff-policy";

describe("handoff recipient checkpoint access", () => {
  const member = { userId: "student-1", displayName: "成员", role: "student" as const };

  it("allows a project-visible checkpoint to a current project member", () => {
    expect(recipientCanReadCheckpoint("project", member, null)).toBe(true);
  });

  it("allows an assignee-visible checkpoint only to its task assignee or an admin", () => {
    expect(recipientCanReadCheckpoint("assignee", member, member.userId)).toBe(true);
    expect(recipientCanReadCheckpoint("assignee", member, "another-user")).toBe(false);
    expect(recipientCanReadCheckpoint("assignee", { ...member, role: "admin" }, "another-user")).toBe(true);
  });
});

describe("handoff reissue eligibility", () => {
  it("allows a fresh offer only after a previous offer is closed unsuccessfully", () => {
    expect(canReissueHandoff("declined")).toBe(true);
    expect(canReissueHandoff("withdrawn")).toBe(true);
    expect(canReissueHandoff("superseded")).toBe(false);
    expect(canReissueHandoff("offered")).toBe(false);
    expect(canReissueHandoff("accepted")).toBe(false);
  });
});
