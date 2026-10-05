import type * as vscode from "vscode";

export type WorkspaceBinding = {
  serverOrigin: string;
  projectId: string;
  workspaceUri: string;
};

export class BindingStore {
  constructor(private readonly state: vscode.Memento) {}

  get(workspaceUri: string): WorkspaceBinding | undefined {
    return this.state.get<WorkspaceBinding>(this.key(workspaceUri));
  }

  async set(binding: WorkspaceBinding): Promise<void> {
    await this.state.update(this.key(binding.workspaceUri), binding);
  }

  async delete(workspaceUri: string): Promise<void> {
    await this.state.update(this.key(workspaceUri), undefined);
  }

  private key(workspaceUri: string): string {
    return `agileCampus.binding.${encodeURIComponent(workspaceUri)}`;
  }
}
