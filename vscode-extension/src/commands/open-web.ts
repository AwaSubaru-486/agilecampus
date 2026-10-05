import * as vscode from "vscode";
import { ProjectViewProvider } from "../views/project-view-provider";

export function registerOpenWebCommand(context: vscode.ExtensionContext, provider: ProjectViewProvider) {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.openProject", () => provider.openProject()));
}
