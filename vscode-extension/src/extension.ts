import * as vscode from "vscode";
import { AgileCampusApiClient } from "./agilecampus/api-client";
import { registerContinueAiCommand } from "./commands/continue-ai";
import { registerOpenWebCommand } from "./commands/open-web";
import { registerReportBlockerCommand } from "./commands/report-blocker";
import { ProjectViewProvider } from "./views/project-view-provider";

export function activate(context: vscode.ExtensionContext): void {
  const baseUrl = vscode.workspace.getConfiguration("agileCampus").get<string>("baseUrl") ?? "http://localhost:3000";
  const provider = new ProjectViewProvider(context.extensionUri, new AgileCampusApiClient(baseUrl));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ProjectViewProvider.viewType, provider));
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.refresh", () => provider.refresh()));
  registerOpenWebCommand(context, provider);
  registerContinueAiCommand(context, provider);
  registerReportBlockerCommand(context, provider);
}

export function deactivate(): void {}
