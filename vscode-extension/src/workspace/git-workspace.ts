import * as path from "node:path";
import * as vscode from "vscode";

type GitRepository = {
  rootUri: vscode.Uri;
  state: { HEAD?: { name?: string } | undefined };
  stateChange: vscode.Event<unknown>;
  remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }>;
};

type GitApi = { repositories: GitRepository[] };
type GitExtensionApi = { getAPI(version: 1): GitApi };

export type GitWorkspaceSnapshot = { repository: string; currentBranch: string | null } | null;

export async function getGitWorkspaceSnapshot(workspaceUri: string): Promise<GitWorkspaceSnapshot> {
  try {
    const extension = vscode.extensions.getExtension<GitExtensionApi>("vscode.git");
    if (!extension) return null;
    const exported = extension.isActive ? extension.exports : await extension.activate();
    const api = exported.getAPI(1);
    const workspacePath = path.resolve(vscode.Uri.parse(workspaceUri).fsPath);
    const isWithin = (parent: string, child: string) => {
      const relative = path.relative(parent, child);
      return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    };
    const candidates = api.repositories.filter((item) => {
      const root = path.resolve(item.rootUri.fsPath);
      return isWithin(root, workspacePath) || isWithin(workspacePath, root);
    });
    const repository = candidates.sort((left, right) => {
      const leftRoot = path.resolve(left.rootUri.fsPath);
      const rightRoot = path.resolve(right.rootUri.fsPath);
      const leftContainsWorkspace = isWithin(leftRoot, workspacePath);
      const rightContainsWorkspace = isWithin(rightRoot, workspacePath);
      if (leftContainsWorkspace !== rightContainsWorkspace) return leftContainsWorkspace ? -1 : 1;
      return rightRoot.length - leftRoot.length;
    })[0];
    if (!repository) return null;
    const remote = repository.remotes.find((item) => item.name === "origin") ?? repository.remotes[0];
    const repositoryName = remote?.fetchUrl ? safeRemoteName(remote.fetchUrl) : path.basename(repository.rootUri.fsPath);
    return { repository: repositoryName, currentBranch: repository.state.HEAD?.name ?? null };
  } catch {
    return null;
  }
}

function safeRemoteName(raw: string): string {
  try {
    const normalized = raw.replace(/^git@([^:]+):/, "https://$1/");
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\.git$/i, "").replace(/\/$/, "");
    return `${url.hostname}${pathname}`;
  } catch {
    return path.basename(raw.replace(/\.git$/i, ""));
  }
}
