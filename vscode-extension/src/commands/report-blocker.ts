import * as vscode from "vscode";
import { ProjectViewProvider } from "../views/project-view-provider";

export function registerReportBlockerCommand(context: vscode.ExtensionContext, provider: ProjectViewProvider) {
  context.subscriptions.push(
    vscode.commands.registerCommand("agilecampus.reportBlocker", (taskId?: string) => {
      if (typeof taskId === "string") provider.openTask(taskId, "work");
      else provider.openProject();
    }),
  );
}
