import type * as vscode from "vscode";
import type { CheckpointIndexPayload } from "../agilecampus/api-client";

export type PendingCheckpointPublish = {
  serverOrigin: string;
  projectId: string;
  taskId: string;
  localCheckpointId: string;
  payload: CheckpointIndexPayload & { idempotencyKey: string };
};

export class CheckpointPublishOperationStore {
  constructor(private readonly state: vscode.Memento) {}

  get(serverOrigin: string, projectId: string, taskId: string, localCheckpointId: string): PendingCheckpointPublish | undefined {
    const value = this.state.get<PendingCheckpointPublish>(this.key(serverOrigin, projectId, taskId, localCheckpointId));
    if (!value || value.serverOrigin !== serverOrigin || value.projectId !== projectId || value.taskId !== taskId || value.localCheckpointId !== localCheckpointId) {
      return undefined;
    }
    return value;
  }

  async set(operation: PendingCheckpointPublish): Promise<void> {
    await this.state.update(this.key(operation.serverOrigin, operation.projectId, operation.taskId, operation.localCheckpointId), operation);
  }

  async clear(serverOrigin: string, projectId: string, taskId: string, localCheckpointId: string): Promise<void> {
    await this.state.update(this.key(serverOrigin, projectId, taskId, localCheckpointId), undefined);
  }

  private key(serverOrigin: string, projectId: string, taskId: string, localCheckpointId: string): string {
    return `agileCampus.checkpointPublish.${[serverOrigin, projectId, taskId, localCheckpointId].map(encodeURIComponent).join(".")}`;
  }
}
