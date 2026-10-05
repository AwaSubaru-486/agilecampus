import * as vscode from "vscode";
import { AttemptStore, type LocalAttempt } from "../attempts/store";
import { getLocalOnlyRepositoryId, selectBoundWorkspace } from "./checkpoint-support";
import { readWorktreeDiffSummary } from "../git/worktree-service";

export function registerCompareAttemptsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.compareAttempts", () => compareAttempts(context)));
}

async function compareAttempts(context: vscode.ExtensionContext): Promise<void> {
  const selectedWorkspace = await selectBoundWorkspace(context);
  if (!selectedWorkspace) return;
  const store = new AttemptStore(context.globalStorageUri.fsPath);
  try {
    const eligible = (await store.list()).filter((item): item is LocalAttempt & { baseSha: string; branch: string } =>
      item.attemptKind === "parallel" && item.baseSha !== null && item.branch !== null && ["finished", "failed"].includes(item.state));
    const checkpoints = [...new Set(eligible.map((item) => item.checkpointId))];
    if (!eligible.length) { void vscode.window.showInformationMessage("还没有完成或失败的并行尝试可供比较。"); return; }
    const checkpointId = checkpoints.length === 1 ? checkpoints[0] : (await vscode.window.showQuickPick(checkpoints.map((id) => ({ label: id, id })), { title: "选择共同 checkpoint" }))?.id;
    if (!checkpointId) return;
    const candidates = eligible.filter((item) => item.checkpointId === checkpointId);
    if (candidates.length < 2) { void vscode.window.showInformationMessage("同一 checkpoint 至少需要两个已结束的并行尝试才能比较。"); return; }
    const picks = await vscode.window.showQuickPick(candidates.map((item) => ({
      label: `${item.state} · ${item.branch ?? item.id.slice(0, 8)}`,
      description: `${item.baseSha.slice(0, 10)} · ${new Date(item.startedAt).toLocaleString()}`,
      id: item.id,
      item,
    })), { title: "选择两个已结束的尝试", canPickMany: true });
    if (!picks || picks.length !== 2) { void vscode.window.showInformationMessage("请选择恰好两个尝试。"); return; }
    if (picks[0].item.baseSha !== picks[1].item.baseSha) { void vscode.window.showErrorMessage("两个尝试的基线 SHA 不同，不能作为同源方案比较。"); return; }
    const localRepositoryId = await getLocalOnlyRepositoryId(context, selectedWorkspace.binding.workspaceUri);
    const summaries = await Promise.all(picks.map(({ item }) => readWorktreeDiffSummary(selectedWorkspace.folder.uri.fsPath, item, localRepositoryId)));
    const lines = [
      `# 并行尝试比较 · checkpoint ${checkpointId}`,
      "",
      `共同基线：${picks[0].item.baseSha}`,
      "本页只汇总 Git 可验证的状态和文件差异，不评价方案优劣。审阅人应打开对应文件和测试证据后作判断。",
      "",
    ];
    for (let index = 0; index < picks.length; index += 1) {
      const attempt = picks[index].item;
      const summary = summaries[index];
      lines.push(
        `## 尝试 ${index === 0 ? "A" : "B"}`,
        `状态：${attempt.state}`,
        `分支：${summary.branch ?? "detached HEAD"}`,
        `HEAD：${summary.headSha}`,
        `新增提交：${summary.commitCount}`,
        `未提交改动：${summary.dirty ? "有" : "无"}`,
        `目录：${summary.path}`,
        "",
        "### 文件差异（checkpoint SHA → 当前工作树）",
        ...(summary.changedFiles.length ? summary.changedFiles.map((file) => `- ${file.index} ${file.path}${file.workingTree ? ` · worktree ${file.workingTree}` : ""}`) : ["- 无跟踪文件差异"]),
        "",
        "### Git diff --stat",
        "```text",
        summary.diffStat || "(empty)",
        "```",
        "",
      );
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") }), { preview: true });
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "读取并行尝试差异失败");
  }
}
