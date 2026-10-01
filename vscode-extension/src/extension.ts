import * as vscode from "vscode";
import { registerContinueAiCommand } from "./commands/continue-ai";
import { registerOpenWebCommand } from "./commands/open-web";
import { registerReportBlockerCommand } from "./commands/report-blocker";
import { registerSaveCheckpointCommand } from "./commands/save-checkpoint";
import { registerListCheckpointsCommand } from "./commands/list-checkpoints";
import { registerExportCheckpointCommand } from "./commands/export-checkpoint";
import { registerImportCheckpointCommand } from "./commands/import-checkpoint";
import { registerPrepareHandoffCommand } from "./commands/prepare-handoff";
import { ProjectViewProvider } from "./views/project-view-provider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ProjectViewProvider(context.extensionUri, context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ProjectViewProvider.viewType, provider));
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.refresh", () => provider.refresh()));
  registerOpenWebCommand(context, provider);
  registerContinueAiCommand(context, provider);
  registerReportBlockerCommand(context, provider);
  registerSaveCheckpointCommand(context);
  registerListCheckpointsCommand(context);
  registerExportCheckpointCommand(context);
  registerImportCheckpointCommand(context);
  registerPrepareHandoffCommand(context);
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.connect", () => provider.connect()));
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.disconnect", () => provider.disconnect()));
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.selectProject", () => provider.selectProject()));
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.openTask", (taskId: unknown) => {
    if (typeof taskId === "string") provider.openTask(taskId, "work");
  }));
}

export function deactivate(): void {}
