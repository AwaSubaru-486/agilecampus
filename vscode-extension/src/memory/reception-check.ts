import { simpleGit } from "simple-git";
import type { MemoryHandoffMaterialV1 } from "../../../shared/task-memory/transfer";

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

const reviewFields = [
  ["completed", "完成记录"], ["decisions", "决策"], ["rejectedApproaches", "失败方案"],
  ["blockers", "阻塞"], ["nextActions", "下一步"],
] as const;
type ReviewMaterial = Pick<MemoryHandoffMaterialV1, typeof reviewFields[number][0] | "tests">;

// A literal path mention is a lead for a person, not a dependency or a proof.
export function renderReceptionMemoryReview(check: ReceptionCodeCheck, material: ReviewMaterial): string {
  if (check.status === "unavailable") return "旧记忆待核对：无法比较代码，不能判断哪些条目受影响。";
  if (check.status === "same") return "旧记忆仅供参考；历史测试没有在当前环境重新运行。";
  const changed = new Set(check.paths);
  const entries = [
    ...reviewFields.flatMap(([field, label]) => material[field].map((text) => ({ label, text }))),
    ...material.tests.map((test) => ({ label: "历史测试（未重跑）", text: test.command })),
  ];
  const matches = entries.flatMap(({ label, text }) => {
    const paths = [...new Set((text.match(/[\w./@-]+/g) ?? []).map((token) => token.replace(/^\.\//, "").replace(/\.+$/, "")))]
      .filter((token) => changed.has(token));
    return paths.length ? [{ label, text, paths }] : [];
  });
  return [
    "旧记忆优先核对（按条目明确写出的变动路径匹配）",
    ...(matches.length ? matches.slice(0, 12).map(({ label, text, paths }) =>
      `- ${label}：${JSON.stringify(text)}（涉及 ${paths.map((file) => JSON.stringify(file)).join("、")}）`)
      : ["没有找到明确引用变动路径的条目。"]),
    ...(matches.length > 12 ? [`另有 ${matches.length - 12} 条命中未展开。`] : []),
    ...(check.omitted ? ["变动路径列表不完整，可能有未列出的命中。"] : []),
    "未命中的条目仍待核对。此提示不判定结论失效、阻塞已解除或测试通过。",
  ].join("\n");
}
