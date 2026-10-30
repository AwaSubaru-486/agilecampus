import { simpleGit } from "simple-git";

export type ReceptionCodeCheck = {
  status: "same" | "changed" | "unavailable";
  paths: string[];
  omitted: number;
  reason?: string;
};

/** Read committed trees only. Never fetch, switch branches, or run a remembered command. */
export async function inspectReceptionCode(workspace: string, baseSha: string, currentSha: string | null): Promise<ReceptionCodeCheck> {
  const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
  if (!sha.test(baseSha) || !currentSha || !sha.test(currentSha)) return { status: "unavailable", paths: [], omitted: 0, reason: "无法读取有效的代码基线" };
  const git = simpleGit(workspace);
  try {
    await git.raw(["cat-file", "-e", `${baseSha}^{commit}`]);
    await git.raw(["cat-file", "-e", `${currentSha}^{commit}`]);
    if (baseSha === currentSha) return { status: "same", paths: [], omitted: 0 };
    // Disabling rename detection includes both the removed and added path.
    const raw = await git.raw(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", baseSha, currentSha, "--"]);
    const paths = raw.split("\0").filter(Boolean);
    return { status: "changed", paths: paths.slice(0, 100), omitted: Math.max(0, paths.length - 100) };
  } catch {
    return { status: "unavailable", paths: [], omitted: 0, reason: "本地缺少基线提交或无法比较；请获取对应代码后重试" };
  }
}

export function renderReceptionCodeCheck(check: ReceptionCodeCheck): string {
  if (check.status === "unavailable") return `代码差异：未核对。${check.reason}`;
  if (check.status === "same") return "代码差异：提交基线一致；历史结论和测试仍需按当前环境验证。";
  return [
    "代码差异：提交基线已变化，尚未判断记忆中的结论是否失效。",
    ...check.paths.map((file) => `变动文件：${JSON.stringify(file)}`),
    ...(check.omitted ? [`另有 ${check.omitted} 个文件未展开。`] : []),
    ...(!check.paths.length ? ["两个提交的文件树相同；提交历史不同。"] : []),
    "先核对上述文件涉及的完成项、失败条件和历史测试，再整理适用于当前代码的断点。",
  ].join("\n");
}
