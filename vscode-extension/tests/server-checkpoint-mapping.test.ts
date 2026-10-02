import { describe, expect, it } from "vitest";
import { ServerCheckpointMappingStore, type ServerCheckpointMapping } from "../src/checkpoints/server-mapping";

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

describe("server checkpoint mappings", () => {
  const mapping: ServerCheckpointMapping = {
    serverOrigin: "https://agile.example/base/",
    projectId: "project-1",
    taskId: "task-2",
    localCheckpointId: "local-3",
    serverCheckpointId: "server-4",
  };

  it("persists and restores the complete local-to-server association", async () => {
    const memory = memoryState();
    await new ServerCheckpointMappingStore(memory.state as never).set(mapping);
    const afterReload = new ServerCheckpointMappingStore(memory.state as never);
    expect(afterReload.get(mapping.serverOrigin, mapping.projectId, mapping.taskId, mapping.localCheckpointId)).toEqual(mapping);
    expect([...memory.values.keys()][0]).toContain(encodeURIComponent(mapping.serverOrigin));
  });

  it("does not return a record stored under a mismatched scope", async () => {
    const memory = memoryState();
    const store = new ServerCheckpointMappingStore(memory.state as never);
    await store.set(mapping);
    expect(store.get(mapping.serverOrigin, mapping.projectId, "other-task", mapping.localCheckpointId)).toBeUndefined();
    expect(store.get("https://other.example/", mapping.projectId, mapping.taskId, mapping.localCheckpointId)).toBeUndefined();
  });
});
