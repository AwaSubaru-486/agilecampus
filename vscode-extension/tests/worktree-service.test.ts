import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCheckpointWorktree, readWorktreeDiffSummary } from "../src/git/worktree-service";
import { readRepositorySnapshot } from "../src/git/repository-service";

const roots: string[] = [];
const localId = "96fd6996-49ee-4d63-85ad-5855f0b4ad5b";
const attemptA = "d87c4e10-09d1-40d6-9e55-62bc029940b9";
const attemptB = "1ebf6bb2-2a62-4a12-aac0-3c0f39f64b0e";
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("checkpoint parallel worktrees", () => {
  it("creates separate branches from the exact checkpoint SHA and keeps same-name edits isolated", async () => {
    const { root, parent, sha } = await createRepository();
    const sourceBefore = git(root, ["branch", "--show-current"]).trim();
    const snapshot = await readRepositorySnapshot(root, localId);
    const [first, second] = await Promise.all([
      createCheckpointWorktree({ workspacePath: root, parentDirectory: parent, localRepositoryId: localId, checkpointRepositoryKey: snapshot.key, checkpointSha: sha, attemptId: attemptA, recoveryBlockers: [] }),
      createCheckpointWorktree({ workspacePath: root, parentDirectory: parent, localRepositoryId: localId, checkpointRepositoryKey: snapshot.key, checkpointSha: sha, attemptId: attemptB, recoveryBlockers: [] }),
    ]);
    expect(first.baseSha).toBe(sha);
    expect(second.baseSha).toBe(sha);
    expect(first.path).not.toBe(second.path);
    expect(first.branch).not.toBe(second.branch);
    await writeFile(path.join(first.path, "tracked.txt"), "solution A\n");
    await writeFile(path.join(second.path, "tracked.txt"), "solution B\n");
    await expect(readFile(path.join(first.path, "tracked.txt"), "utf8")).resolves.toBe("solution A\n");
    await expect(readFile(path.join(second.path, "tracked.txt"), "utf8")).resolves.toBe("solution B\n");
    await expect(readFile(path.join(root, "tracked.txt"), "utf8")).resolves.toBe("shared checkpoint base\n");
    expect(git(root, ["branch", "--show-current"]).trim()).toBe(sourceBefore);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
    const summaryA = await readWorktreeDiffSummary(root, { id: attemptA, workdir: first.path, branch: first.branch, baseSha: first.baseSha }, localId);
    const summaryB = await readWorktreeDiffSummary(root, { id: attemptB, workdir: second.path, branch: second.branch, baseSha: second.baseSha }, localId);
    expect(summaryA.changedFiles.map((file) => file.path)).toContain("tracked.txt");
    expect(summaryB.changedFiles.map((file) => file.path)).toContain("tracked.txt");
    expect(summaryA.dirty).toBe(true);
    expect(summaryB.dirty).toBe(true);
    expect(summaryA.path).not.toBe(summaryB.path);
  });

  it("blocks dirty source worktrees and refuses to place an attempt inside the repository", async () => {
    const { root, sha } = await createRepository();
    const snapshot = await readRepositorySnapshot(root, localId);
    await writeFile(path.join(root, "untracked.txt"), "keep me\n");
    await expect(createCheckpointWorktree({ workspacePath: root, parentDirectory: root, localRepositoryId: localId, checkpointRepositoryKey: snapshot.key, checkpointSha: sha, attemptId: attemptA, recoveryBlockers: [] }))
      .rejects.toThrow("源工作区有未提交");
    await rm(path.join(root, "untracked.txt"));
    await expect(createCheckpointWorktree({ workspacePath: root, parentDirectory: root, localRepositoryId: localId, checkpointRepositoryKey: snapshot.key, checkpointSha: sha, attemptId: attemptA, recoveryBlockers: [] }))
      .rejects.toThrow("源仓库之外");
  });

  it("refuses missing commits and known LFS/submodule recovery blockers without fetching", async () => {
    const { root, parent, sha } = await createRepository();
    const snapshot = await readRepositorySnapshot(root, localId);
    await expect(createCheckpointWorktree({ workspacePath: root, parentDirectory: parent, localRepositoryId: localId, checkpointRepositoryKey: snapshot.key, checkpointSha: "f".repeat(40), attemptId: attemptA, recoveryBlockers: [] }))
      .rejects.toThrow("不在本机 Git 对象库");
    await expect(createCheckpointWorktree({ workspacePath: root, parentDirectory: parent, localRepositoryId: localId, checkpointRepositoryKey: snapshot.key, checkpointSha: sha, attemptId: attemptB, recoveryBlockers: ["LFS not packaged"] }))
      .rejects.toThrow("不支持 worktree 恢复");
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(sha);
  });

  it("chooses a new branch name when the generated branch already exists", async () => {
    const { root, parent, sha } = await createRepository();
    const snapshot = await readRepositorySnapshot(root, localId);
    const existingBranch = `agilecampus/attempt-${attemptA.replace(/-/g, "").slice(0, 12)}`;
    git(root, ["branch", existingBranch, sha]);
    const result = await createCheckpointWorktree({
      workspacePath: root, parentDirectory: parent, localRepositoryId: localId,
      checkpointRepositoryKey: snapshot.key, checkpointSha: sha, attemptId: attemptA, recoveryBlockers: [],
    });
    expect(result.branch).toBe(`${existingBranch}-1`);
    expect(git(root, ["branch", "--list", existingBranch]).trim()).toContain(existingBranch);
  });
});

async function createRepository(): Promise<{ root: string; parent: string; sha: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "agile-worktree-test-")); roots.push(base);
  const root = path.join(base, "source");
  const parent = path.join(base, "attempts");
  await mkdir(root);
  await mkdir(parent);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Worktree Test"]);
  git(root, ["config", "user.email", "worktree@example.invalid"]);
  await writeFile(path.join(root, "tracked.txt"), "shared checkpoint base\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-m", "shared baseline"]);
  return { root, parent, sha: git(root, ["rev-parse", "HEAD"]).trim() };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
