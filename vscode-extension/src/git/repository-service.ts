import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";

export type RepositorySnapshot = {
  rootPath: string;
  key: string;
  headSha: string;
  branch: string | null;
  dirty: boolean;
  recoveryBlockers: string[];
};

export class RepositoryError extends Error {
  constructor(message: string) { super(message); this.name = "RepositoryError"; }
}

export async function readRepositorySnapshot(workspacePath: string, localOnlyId: string): Promise<RepositorySnapshot> {
  let workspaceRoot: string;
  try { workspaceRoot = await realpath(workspacePath); }
  catch { throw new RepositoryError("所选工作区目录不存在或不可访问"); }
  if (!/^[0-9a-f-]{36}$/i.test(localOnlyId)) throw new RepositoryError("本机仓库标识无效");

  const git = simpleGit(workspaceRoot);
  let rootPath: string;
  let headSha: string;
  let branchName: string;
  let status;
  let remotes;
  try {
    rootPath = await realpath((await git.raw(["rev-parse", "--show-toplevel"])).trim());
    if (!isWithin(workspaceRoot, rootPath)) throw new RepositoryError("Git 仓库根目录超出当前工作区");
    headSha = (await git.revparse("HEAD")).trim();
    status = await git.status();
    branchName = status.current ?? "HEAD";
    remotes = await git.getRemotes(true);
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    throw new RepositoryError("当前目录没有可读取的 Git 提交；请先建立首个提交");
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(headSha)) throw new RepositoryError("Git HEAD 不是有效提交 SHA");
  const remoteKeys = remotes.flatMap((remote) => [remote.refs.fetch, remote.refs.push]
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map(normalizeRemote))
    .filter((value): value is string => value !== null);
  const uniqueRemotes = [...new Set(remoteKeys)].sort();
  const key = uniqueRemotes.length
    ? `remote:${createHash("sha256").update(uniqueRemotes.join("\n")).digest("hex")}`
    : `local:${localOnlyId}`;
  const recoveryBlockers = await inspectRecoveryBlockers(git, rootPath);
  return {
    rootPath,
    key,
    headSha,
    branch: branchName === "HEAD" ? null : branchName,
    dirty: !status.isClean(),
    recoveryBlockers,
  };
}

export function sameRepositorySnapshot(before: RepositorySnapshot, after: RepositorySnapshot): boolean {
  return before.rootPath === after.rootPath && before.key === after.key && before.headSha === after.headSha &&
    before.branch === after.branch && before.dirty === after.dirty &&
    JSON.stringify(before.recoveryBlockers) === JSON.stringify(after.recoveryBlockers);
}

function normalizeRemote(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (["http:", "https:", "ssh:", "git:"].includes(url.protocol)) {
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\.git$/i, "").replace(/\/$/, "")}`;
    }
  } catch { /* SCP-style SSH or local remote path. */ }
  const scp = /^(?:[^@/:]+@)?([^:/]+):(.+)$/.exec(raw);
  if (scp) return `ssh://${scp[1].toLowerCase()}/${scp[2].replace(/\.git$/i, "").replace(/^\/+/, "")}`;
  if (raw.startsWith("file://")) {
    try { return `file://${new URL(raw).pathname}`; }
    catch { return null; }
  }
  return null;
}

async function inspectRecoveryBlockers(git: ReturnType<typeof simpleGit>, rootPath: string): Promise<string[]> {
  const blockers: string[] = [];
  try {
    const submodules = await git.raw(["ls-tree", "--name-only", "HEAD", "--", ".gitmodules"]);
    if (submodules.trim()) blockers.push("Git submodules are not packaged by this checkpoint implementation.");
  } catch { /* No committed submodule manifest. */ }
  try {
    const listed = await git.raw(["ls-files", "-z", "--", ".gitattributes", "**/.gitattributes"]);
    const files = listed.split("\0").filter(Boolean);
    for (const relative of files) {
      const fullPath = path.resolve(rootPath, relative);
      if (!isWithin(rootPath, fullPath)) continue;
      try {
        const attributes = await git.raw(["show", `HEAD:${relative}`]);
        if (/^\s*[^#\r\n]*\bfilter\s*=\s*lfs\b/im.test(attributes)) {
          blockers.push("Git LFS content is not packaged by this checkpoint implementation.");
          break;
        }
      } catch { /* Missing working-tree attributes will be visible as dirty if tracked. */ }
    }
  } catch { /* An unreadable attributes index does not become a false positive. */ }
  return blockers;
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
