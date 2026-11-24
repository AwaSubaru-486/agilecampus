import { describe, expect, it } from "vitest";
import { githubLinkLabel, parseGitHubLink } from "@/lib/github/link";

describe("parseGitHubLink", () => {
  it("normalizes repositories, issues, pull requests and action runs", () => {
    expect(parseGitHubLink("https://github.com/AwaSubaru-486/agilecampus/")).toMatchObject({
      kind: "repository",
      owner: "AwaSubaru-486",
      repo: "agilecampus",
      url: "https://github.com/AwaSubaru-486/agilecampus",
    });
    expect(parseGitHubLink("https://github.com/org/repo/issues/42?x=1")).toMatchObject({ kind: "issue", number: 42 });
    expect(parseGitHubLink("https://github.com/org/repo/pull/7/files")).toMatchObject({ kind: "pull_request", number: 7 });
    expect(parseGitHubLink("https://github.com/org/repo/actions/runs/123")).toMatchObject({ kind: "actions_run", runId: 123 });
  });

  it("rejects unsupported or unsafe paths", () => {
    expect(parseGitHubLink("https://github.com/org/repo/settings/secrets")).toBeNull();
    expect(parseGitHubLink("https://example.com/org/repo/issues/1")).toBeNull();
    expect(parseGitHubLink("not a url")).toBeNull();
  });

  it("creates readable evidence labels", () => {
    const link = parseGitHubLink("https://github.com/org/repo/pull/7")!;
    expect(githubLinkLabel(link)).toBe("org/repo · PR #7");
  });
});
