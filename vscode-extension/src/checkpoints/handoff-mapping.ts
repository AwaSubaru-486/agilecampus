import type * as vscode from "vscode";

export type HandoffOperationMapping = {
  serverOrigin: string;
  projectId: string;
  taskId: string;
  localCheckpointId: string;
  serverCheckpointId: string;
  recipientUserId: string;
  expectedTaskUpdatedAt: string;
  expectedHandoffVersion: number;
  idempotencyKey: string;
  handoffId: string | null;
};

export class HandoffMappingStore {
  constructor(private readonly state: vscode.Memento) {}

  get(serverOrigin: string, projectId: string, taskId: string, localCheckpointId: string, recipientUserId: string): HandoffOperationMapping | undefined {
    const mapping = this.state.get<HandoffOperationMapping>(this.key(serverOrigin, projectId, taskId, localCheckpointId, recipientUserId));
    if (
      !mapping || mapping.serverOrigin !== serverOrigin || mapping.projectId !== projectId || mapping.taskId !== taskId ||
      mapping.localCheckpointId !== localCheckpointId || mapping.recipientUserId !== recipientUserId
    ) return undefined;
    return mapping;
  }

  async set(mapping: HandoffOperationMapping): Promise<void> {
    await this.state.update(this.key(mapping.serverOrigin, mapping.projectId, mapping.taskId, mapping.localCheckpointId, mapping.recipientUserId), mapping);
  }

  private key(serverOrigin: string, projectId: string, taskId: string, localCheckpointId: string, recipientUserId: string): string {
    return `agileCampus.handoff.${[serverOrigin, projectId, taskId, localCheckpointId, recipientUserId].map(encodeURIComponent).join(".")}`;
  }
}
