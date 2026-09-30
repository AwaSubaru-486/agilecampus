import * as vscode from "vscode";
import { ProjectViewProvider } from "../views/project-view-provider";

export function registerContinueAiCommand(context: vscode.ExtensionContext, provider: ProjectViewProvider) {
  context.subscriptions.push(
      vscode.commands.registerCommand("agilecampus.continueAiWork", (taskId?: string) => {
        if (typeof taskId === "string") provider.openTask(taskId, "studio");
        else provider.openProject();
      }),
  );
}
