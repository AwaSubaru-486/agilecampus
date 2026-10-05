import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasCommit, readRepositorySnapshot } from "../src/git/repository-service";

const roots: string[] = [];
const localId = "96fd6996-49ee-4d63-85ad-5855f0b4ad5b";
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("checkpoint Git snapshot", () => {
  it("records exact HEAD, branch, and clean status without persisting remote credentials", async () => {
    const root = await createRepository();
    git(root, ["remote", "add", "origin", "https://alice:supersecret@github.com/team/repo.git"]);
    const snapshot = await readRepositorySnapshot(root, localId);
    expect(snapshot).toMatchObject({ branch: expect.any(String), dirty: false, recoveryBlockers: [] });
    expect(snapshot.headSha).toMatch(/^[0-9a-f]{40,64}$/i);
    expect(snapshot.key).toMatch(/^remote:[0-9a-f]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain("supersecret");
    expect(snapshot.rootPath).toBe(await realpath(root));
  });

  it("marks staged, unstaged, and untracked changes as dirty without staging or committing them", async () => {
    const root = await createRepository();
    await writeFile(path.join(root, "tracked.txt"), "changed\n");
    await writeFile(path.join(root, "new.txt"), "untracked\n");
    const snapshot = await readRepositorySnapshot(root, localId);
    expect(snapshot.dirty).toBe(true);
    expect(git(root, ["status", "--porcelain"])).toContain("?? new.txt");
    expect(git(root, ["status", "--porcelain"])).toContain(" M tracked.txt");
  });

  it("records detached HEAD and a stable local-only repository ID", async () => {
    const root = await createRepository();
    git(root, ["checkout", "--detach", "HEAD"]);
    const snapshot = await readRepositorySnapshot(root, localId);
    expect(snapshot.branch).toBeNull();
    expect(snapshot.key).toBe(`local:${localId}`);
  });

  it("blocks unsupported submodule and LFS restoration data", async () => {
    const root = await createRepository();
    await writeFile(path.join(root, ".gitmodules"), "[submodule \"x\"]\n path = x\n");
    await writeFile(path.join(root, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
    git(root, ["add", ".gitmodules", ".gitattributes"]);
    git(root, ["commit", "-m", "add unsupported metadata"]);
    const snapshot = await readRepositorySnapshot(root, localId);
    expect(snapshot.recoveryBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining("submodules"), expect.stringContaining("LFS"),
    ]));
  });

  it("refuses a repository without an initial commit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-repo-unborn-"));
    roots.push(root);
    git(root, ["init", "-q"]);
    await expect(readRepositorySnapshot(root, localId)).rejects.toThrow("首个提交");
  });

  it("checks a checkpoint SHA without fetching or changing the repository", async () => {
    const root = await createRepository();
    const before = git(root, ["rev-parse", "HEAD"]).trim();
    await expect(hasCommit(root, before)).resolves.toBe(true);
    await expect(hasCommit(root, "f".repeat(40))).resolves.toBe(false);
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(before);
  });

  it("does not resolve a repository above the selected trusted workspace", async () => {
    const root = await createRepository();
    const nested = path.join(root, "nested");
    await mkdir(nested);
    await expect(readRepositorySnapshot(nested, localId)).rejects.toThrow("超出当前工作区");
  });
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agile-checkpoint-repo-"));
  roots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Checkpoint Test"]);
  git(root, ["config", "user.email", "checkpoint@example.invalid"]);
  await writeFile(path.join(root, "tracked.txt"), "baseline\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-m", "baseline"]);
  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
