import * as vscode from "vscode";

export async function getGitHubSession(createIfNone = false): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession("github", ["repo", "read:user"], { createIfNone });
}
