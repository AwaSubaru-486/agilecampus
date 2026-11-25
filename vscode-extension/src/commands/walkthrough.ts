import * as vscode from "vscode";

export function openWalkthrough(): Thenable<unknown> {
  return vscode.commands.executeCommand("workbench.action.openWalkthrough", "agilecampus.agilecampus-vscode#task-memory");
}
