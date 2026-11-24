import { describe, expect, it } from "vitest";
import { HandoffMappingStore, type HandoffOperationMapping } from "../src/checkpoints/handoff-mapping";

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

describe("handoff request mapping", () => {
  const mapping: HandoffOperationMapping = {
    serverOrigin: "https://agile.example/", projectId: "project-1", taskId: "task-2",
    localCheckpointId: "local-3", serverCheckpointId: "server-4", recipientUserId: "member-5",
    expectedTaskUpdatedAt: "2026-10-01T00:00:00.000Z", expectedHandoffVersion: 4,
    idempotencyKey: "d87c4e10-09d1-40d6-9e55-62bc029940c0", handoffId: null,
  };

  it("preserves the same request identity until the server handoff ID is confirmed", async () => {
    const memory = memoryState();
    const store = new HandoffMappingStore(memory.state as never);
    await store.set(mapping);
    const restored = new HandoffMappingStore(memory.state as never).get(
      mapping.serverOrigin, mapping.projectId, mapping.taskId, mapping.localCheckpointId, mapping.recipientUserId,
    );
    expect(restored).toEqual(mapping);
    expect(restored?.idempotencyKey).toBe(mapping.idempotencyKey);

    await store.set({ ...mapping, handoffId: "confirmed-handoff-id" });
    expect(store.get(mapping.serverOrigin, mapping.projectId, mapping.taskId, mapping.localCheckpointId, mapping.recipientUserId)?.handoffId)
      .toBe("confirmed-handoff-id");
  });

  it("does not return a pending request for a different recipient", async () => {
    const memory = memoryState();
    const store = new HandoffMappingStore(memory.state as never);
    await store.set(mapping);
    expect(store.get(mapping.serverOrigin, mapping.projectId, mapping.taskId, mapping.localCheckpointId, "other-member")).toBeUndefined();
  });
});
