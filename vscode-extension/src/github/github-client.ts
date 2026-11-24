import type * as vscode from "vscode";

export class GitHubClient {
  constructor(private readonly session: vscode.AuthenticationSession) {}

  async getRepository(owner: string, repo: string): Promise<unknown> {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.session.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub 请求失败：${response.status}`);
    return response.json();
  }
}
