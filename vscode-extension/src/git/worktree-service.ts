import { lstat, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { hasCommit, readRepositorySnapshot } from "./repository-service";

export type CheckpointWorktree = {
  path: string;
  branch: string;
  baseSha: string;
  repositoryKey: string;
};

export type WorktreeDiffSummary = {
  path: string;
  branch: string | null;
  headSha: string;
  baseSha: string;
  commitCount: number;
  dirty: boolean;
  changedFiles: Array<{ path: string; index: string; workingTree: string }>;
  diffStat: string;
};

const attemptIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repositoryQueues = new Map<string, Promise<void>>();

export class WorktreeError extends Error {
  constructor(message: string) { super(message); this.name = "WorktreeError"; }
}

export async function resolveAttemptWorktreeLocation(parentDirectory: string, attemptId: string): Promise<{ path: string; branch: string }> {
  if (!attemptIdPattern.test(attemptId)) throw new WorktreeError("Attempt ID 格式无效");
  let parent: string;
  try {
    parent = await realpath(parentDirectory);
    if (!(await stat(parent)).isDirectory()) throw new WorktreeError("所选父目录不是目录");
  } catch (error) {
    if (error instanceof WorktreeError) throw error;
    throw new WorktreeError("所选 worktree 父目录不存在或不可访问");
  }
  return {
    path: path.join(parent, `agilecampus-attempt-${attemptId.slice(0, 8)}`),
    branch: `agilecampus/attempt-${attemptId.replace(/-/g, "").slice(0, 12)}`,
  };
}

export async function createCheckpointWorktree(input: {
  workspacePath: string;
  parentDirectory: string;
  localRepositoryId: string;
  checkpointRepositoryKey: string;
  checkpointSha: string;
  attemptId: string;
  recoveryBlockers: string[];
}): Promise<CheckpointWorktree> {
  if (!attemptIdPattern.test(input.attemptId)) throw new WorktreeError("Attempt ID 格式无效");
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(input.checkpointSha)) throw new WorktreeError("检查点 SHA 无效");
  if (input.recoveryBlockers.length) throw new WorktreeError(`检查点包含暂不支持 worktree 恢复的内容：${input.recoveryBlockers.join(" ")}`);
  const snapshot = await readRepositorySnapshot(input.workspacePath, input.localRepositoryId);
  if (snapshot.key !== input.checkpointRepositoryKey) throw new WorktreeError("当前工作区与检查点仓库不匹配");
  if (snapshot.dirty) throw new WorktreeError("源工作区有未提交或未跟踪改动；为避免遗漏或覆盖，不能创建并行尝试");
  if (!await hasCommit(snapshot.rootPath, input.checkpointSha)) throw new WorktreeError("检查点 SHA 不在本机 Git 对象库；未联网 fetch");
  let parent: string;
  try {
    parent = await realpath(input.parentDirectory);
    if (!(await stat(parent)).isDirectory()) throw new WorktreeError("所选父目录不是目录");
  } catch (error) {
    if (error instanceof WorktreeError) throw error;
    throw new WorktreeError("所选 worktree 父目录不存在或不可访问");
  }

  const location = await resolveAttemptWorktreeLocation(parent, input.attemptId);
  const target = location.path;
  const relative = path.relative(snapshot.rootPath, target);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new WorktreeError("worktree 必须位于源仓库之外的专用目录");
  }
  try { await lstat(target); throw new WorktreeError("生成的尝试目录已存在；未覆盖原目录"); }
  catch (error) { if (error instanceof WorktreeError) throw error; if (!isCode(error, "ENOENT")) throw new WorktreeError("无法检查目标目录"); }

  return withRepositoryLock(snapshot.rootPath, async () => {
    // Recheck under the per-repository lock immediately before Git creates the worktree.
    const latest = await readRepositorySnapshot(snapshot.rootPath, input.localRepositoryId);
    if (latest.key !== snapshot.key || latest.dirty) throw new WorktreeError("源仓库状态已变化；请重新检查后再试");
    if (!await hasCommit(snapshot.rootPath, input.checkpointSha)) throw new WorktreeError("检查点 SHA 已不可用；未创建 worktree");
    const git = simpleGit(snapshot.rootPath);
    let branch = location.branch;
    let worktreeCreated = false;
    for (let suffix = 0; suffix < 8; suffix += 1) {
      const localBranches = (await git.branchLocal()).all;
      if (localBranches.includes(branch)) { branch = `${location.branch}-${suffix + 1}`; continue; }
      try {
        await git.raw(["worktree", "add", "-b", branch, target, input.checkpointSha]);
        worktreeCreated = true;
        break;
      } catch {
        const branchNowExists = (await git.branchLocal()).all.includes(branch);
        let targetNowExists = false;
        try { await lstat(target); targetNowExists = true; } catch { /* No path was created. */ }
        if (branchNowExists && !targetNowExists) { branch = `${location.branch}-${suffix + 1}`; continue; }
        throw new WorktreeError("Git 无法创建此 worktree；未运行安装/初始化脚本，也未删除任何目录");
      }
    }
    if (!worktreeCreated) throw new WorktreeError("无法生成不冲突的 Git 分支；没有覆盖已有分支");
    let createdSnapshot;
    try { createdSnapshot = await readRepositorySnapshot(target, input.localRepositoryId); }
    catch { throw new WorktreeError(`worktree 已创建，但无法核验目标；请保留目录并人工检查：${target}`); }
    if (createdSnapshot.rootPath !== await realpath(target) || createdSnapshot.key !== input.checkpointRepositoryKey ||
        createdSnapshot.headSha !== input.checkpointSha || createdSnapshot.branch !== branch || createdSnapshot.dirty || createdSnapshot.recoveryBlockers.length) {
      throw new WorktreeError(`worktree 已创建，但基线校验不通过；未自动删除目录：${target}`);
    }
    return { path: createdSnapshot.rootPath, branch, baseSha: input.checkpointSha, repositoryKey: createdSnapshot.key };
  });
}

export async function isRegisteredWorktree(sourceRepositoryPath: string, candidatePath: string): Promise<boolean> {
  try {
    const sourceRoot = await realpath(sourceRepositoryPath);
    const candidateRoot = await realpath(candidatePath);
    const listings = await simpleGit(sourceRoot).raw(["worktree", "list", "--porcelain"]);
    const listedPaths = listings.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
    for (const listed of listedPaths) {
      try { if (await realpath(listed) === candidateRoot) return true; }
      catch { /* Ignore pruned or inaccessible worktree entries. */ }
    }
  } catch { return false; }
  return false;
}

export async function readWorktreeDiffSummary(sourceRepositoryPath: string, attempt: {
  id: string; workdir: string; branch: string | null; baseSha: string;
}, localRepositoryId: string): Promise<WorktreeDiffSummary> {
  if (!attemptIdPattern.test(attempt.id) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(attempt.baseSha)) {
    throw new WorktreeError("并行尝试记录无效");
  }
  const sourceRoot = await realpath(sourceRepositoryPath);
  const targetRoot = await realpath(attempt.workdir);
  if (targetRoot === sourceRoot || isWithin(sourceRoot, targetRoot)) throw new WorktreeError("并行尝试目录不能位于源仓库内部");
  if (!await isRegisteredWorktree(sourceRoot, targetRoot)) throw new WorktreeError("目标不是当前仓库注册的 worktree");
  const snapshot = await readRepositorySnapshot(targetRoot, localRepositoryId);
  const expectedBranch = `agilecampus/attempt-${attempt.id.replace(/-/g, "").slice(0, 12)}`;
  if ((!attempt.branch || (attempt.branch !== expectedBranch && !new RegExp(`^${expectedBranch}-[1-9][0-9]*$`).test(attempt.branch))) || snapshot.branch !== attempt.branch) {
    throw new WorktreeError("worktree 当前分支与尝试记录不匹配");
  }
  if (snapshot.key !== (await readRepositorySnapshot(sourceRoot, localRepositoryId)).key) throw new WorktreeError("尝试目录仓库身份不匹配");
  if (!await hasCommit(targetRoot, attempt.baseSha)) throw new WorktreeError("尝试的共同基线 SHA 不存在");
  const git = simpleGit(targetRoot);
  const changed = await git.diff(["--name-status", "--no-ext-diff", "--no-textconv", attempt.baseSha, "--"]);
  const status = await git.status();
  const commitCountText = await git.raw(["rev-list", "--count", `${attempt.baseSha}..HEAD`]);
  const count = Number.parseInt(commitCountText.trim(), 10);
  if (!Number.isSafeInteger(count) || count < 0) throw new WorktreeError("无法读取 worktree 提交差异");
  const statText = await git.diff(["--stat", "--no-ext-diff", "--no-textconv", attempt.baseSha, "--"]);
  const changedFiles = changed.split(/\r?\n/).filter(Boolean).map((line) => {
    const [index = "", filePath = ""] = line.split(/\t/, 2);
    return { path: filePath, index, workingTree: status.files.find((file) => file.path === filePath)?.working_dir ?? "" };
  });
  const knownPaths = new Set(changedFiles.map((file) => file.path));
  for (const file of status.files) {
    if (!knownPaths.has(file.path)) changedFiles.push({ path: file.path, index: file.index, workingTree: file.working_dir });
  }
  return {
    path: targetRoot, branch: snapshot.branch, headSha: snapshot.headSha, baseSha: attempt.baseSha,
    commitCount: count, dirty: !status.isClean(),
    changedFiles,
    diffStat: statText.trim(),
  };
}

async function withRepositoryLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = repositoryQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  repositoryQueues.set(key, queued);
  await previous;
  try { return await run(); }
  finally {
    release();
    if (repositoryQueues.get(key) === queued) repositoryQueues.delete(key);
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
