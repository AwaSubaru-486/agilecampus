import type * as vscode from "vscode";

export type ServerCheckpointMapping = {
  serverOrigin: string;
  projectId: string;
  taskId: string;
  localCheckpointId: string;
  serverCheckpointId: string;
};

export class ServerCheckpointMappingStore {
  constructor(private readonly state: vscode.Memento) {}

  get(serverOrigin: string, projectId: string, taskId: string, localCheckpointId: string): ServerCheckpointMapping | undefined {
    const mapping = this.state.get<ServerCheckpointMapping>(this.key(serverOrigin, projectId, taskId, localCheckpointId));
    if (!mapping || mapping.serverOrigin !== serverOrigin || mapping.projectId !== projectId || mapping.taskId !== taskId || mapping.localCheckpointId !== localCheckpointId) {
      return undefined;
    }
    return mapping;
  }

  async set(mapping: ServerCheckpointMapping): Promise<void> {
    await this.state.update(this.key(mapping.serverOrigin, mapping.projectId, mapping.taskId, mapping.localCheckpointId), mapping);
  }

  private key(serverOrigin: string, projectId: string, taskId: string, localCheckpointId: string): string {
    return `agileCampus.serverCheckpoint.${[serverOrigin, projectId, taskId, localCheckpointId].map(encodeURIComponent).join(".")}`;
  }
}
