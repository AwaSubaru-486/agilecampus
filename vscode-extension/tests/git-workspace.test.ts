import { beforeEach, describe, expect, it, vi } from "vitest";

const gitFixture = vi.hoisted(() => ({ extension: null as unknown }));

vi.mock("vscode", () => ({
  extensions: { getExtension: () => gitFixture.extension },
  Uri: { parse: (value: string) => ({ fsPath: new URL(value).pathname }) },
}));

import { getGitWorkspaceSnapshot } from "../src/workspace/git-workspace";

describe("VS Code Git workspace snapshot", () => {
  beforeEach(() => { gitFixture.extension = null; });

  it("reads the current branch and remote from RepositoryState", async () => {
    gitFixture.extension = {
      isActive: true,
      exports: {
        getAPI: () => ({ repositories: [{
          rootUri: { fsPath: "/work/project" },
          state: {
            HEAD: { name: "feature/checkpoint" },
            remotes: [{ name: "origin", fetchUrl: "git@github.com:team/agilecampus.git" }],
          },
        }] }),
      },
    };

    await expect(getGitWorkspaceSnapshot("file:///work/project/packages/web"))
      .resolves.toEqual({ repository: "github.com/team/agilecampus", currentBranch: "feature/checkpoint" });
  });

  it("returns no repository when the Git extension is unavailable", async () => {
    await expect(getGitWorkspaceSnapshot("file:///work/project")).resolves.toBeNull();
  });
});
