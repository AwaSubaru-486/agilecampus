import { describe, expect, it } from "vitest";
import { CheckpointPublishOperationStore, type PendingCheckpointPublish } from "../src/checkpoints/publish-operation";

function memoryState() {
  const values = new Map<string, unknown>();
  return {
    values,
    state: {
      get: <T>(key: string) => values.get(key) as T | undefined,
      update: async (key: string, value: unknown) => { if (value === undefined) values.delete(key); else values.set(key, value); },
    },
  };
}

describe("pending checkpoint publish operation", () => {
  it("keeps the exact payload and visibility across restart, then clears after reconciliation", async () => {
    const operation: PendingCheckpointPublish = {
      serverOrigin: "https://agile.example/",
      projectId: "project",
      taskId: "task",
      localCheckpointId: "local-checkpoint",
      payload: {
        idempotencyKey: "00000000-0000-5000-8000-000000000001",
        visibility: "assignee",
        parentCheckpointId: "server-parent",
        taskHandoffVersion: 2,
        taskUpdatedAt: "2026-10-01T00:00:00.000Z",
        repositoryKeyHash: "repo-hash",
        headSha: "a".repeat(40),
        source: { provider: "Codex", providerVersion: "1", captureMode: "context-only" },
        handoffSummary: { goal: "goal", completed: [], remaining: ["next"], blocker: null, nextAction: "next" },
        materials: [],
      },
    };
    const memory = memoryState();
    await new CheckpointPublishOperationStore(memory.state as never).set(operation);
    const afterRestart = new CheckpointPublishOperationStore(memory.state as never);
    expect(afterRestart.get(operation.serverOrigin, operation.projectId, operation.taskId, operation.localCheckpointId)).toEqual(operation);
    await afterRestart.clear(operation.serverOrigin, operation.projectId, operation.taskId, operation.localCheckpointId);
    expect(afterRestart.get(operation.serverOrigin, operation.projectId, operation.taskId, operation.localCheckpointId)).toBeUndefined();
  });
});
