import * as vscode from "vscode";
import { ProjectViewProvider } from "../views/project-view-provider";

export function registerReportBlockerCommand(context: vscode.ExtensionContext, provider: ProjectViewProvider) {
  context.subscriptions.push(
    vscode.commands.registerCommand("agilecampus.reportBlocker", async (taskId?: string) => {
      await vscode.window.showInputBox({ prompt: "描述当前卡点，网页端会打开对应的协作入口。" });
      provider.reportBlocker(taskId);
    }),
  );
}
