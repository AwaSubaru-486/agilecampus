import * as vscode from "vscode";
import { CheckpointStore } from "../checkpoints/store";
import { selectBoundWorkspace } from "./checkpoint-support";

export function registerListCheckpointsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.listCheckpoints", () => listCheckpoints(context)));
}

async function listCheckpoints(context: vscode.ExtensionContext): Promise<void> {
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const store = new CheckpointStore(context.globalStorageUri.fsPath);
  try {
    const records = await store.list(selected.binding.serverOrigin, selected.binding.projectId);
    if (!records.length) {
      void vscode.window.showInformationMessage("此项目在本机还没有保存检查点。");
      return;
    }
    const choice = await vscode.window.showQuickPick(records.map(({ manifest }) => ({
      label: manifest.handoff.goal,
      description: `${new Date(manifest.capturedAt).toLocaleString()} · ${manifest.repository.headSha.slice(0, 10)}`,
      detail: `${manifest.handoff.nextAction} · ${manifest.session.captureMode} · ${manifest.artifacts.length} 个附件`,
      id: manifest.id,
    })), { title: "本机检查点", placeHolder: "检查点保存在此电脑；查看不会启动 Agent 或修改 Git" });
    if (!choice) return;
    const manifest = await store.read(selected.binding.serverOrigin, selected.binding.projectId, choice.id);
    if (!manifest) throw new Error("所选检查点已不存在");
    const lines = [
      `# ${manifest.handoff.goal}`,
      "",
      `检查点：${manifest.id}`,
      `保存时间：${manifest.capturedAt}`,
      `任务：${manifest.taskId}`,
      `交接版本：${manifest.handoffVersion}`,
      `代码基线：${manifest.repository.headSha}`,
      `分支：${manifest.repository.branch ?? "detached HEAD"}`,
      `代码状态：${manifest.repository.dirty ? "未提交修改已排除" : "HEAD 干净"}`,
      `接续方式：${manifest.session.captureMode}（不代表可原生恢复）`,
      `会话：${manifest.session.sessionId ?? "未附加"}`,
      `附件：${manifest.artifacts.length} 个；读取时 SHA-256 校验通过`,
      "",
      "## 已完成",
      ...(manifest.handoff.completed.length ? manifest.handoff.completed.map((item) => `- ${item}`) : ["- 未填写"]),
      "",
      "## 待完成",
      ...(manifest.handoff.remaining.length ? manifest.handoff.remaining.map((item) => `- ${item}`) : ["- 未填写"]),
      "",
      `## 当前阻塞\n${manifest.handoff.blocker ?? "无"}`,
      "",
      "## 已放弃方案",
      ...(manifest.handoff.rejectedApproaches.length ? manifest.handoff.rejectedApproaches.map((item) => `- ${item}`) : ["- 未填写"]),
      "",
      `## 下一步\n${manifest.handoff.nextAction}`,
      "",
      ...(manifest.repository.recoveryBlockers.length ? [`恢复限制：${manifest.repository.recoveryBlockers.join(" ")}`] : []),
    ];
    const document = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") });
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取本地检查点");
  }
}
