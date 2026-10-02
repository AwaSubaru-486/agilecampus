import { describe, expect, it } from "vitest";
import { fullCheckpointMatches, toCheckpointIndexPayload } from "../src/checkpoints/index-payload";
import type { ServerCheckpoint } from "../src/agilecampus/api-client";
import type { WorkCheckpoint } from "../src/checkpoints/types";

const manifest: WorkCheckpoint = {
  schemaVersion: 1, id: "local-checkpoint", parentCheckpointId: null, serverOrigin: "https://agile.example/",
  projectId: "project", taskId: "task", milestoneId: null, capturedAt: "2026-10-01T00:00:00.000Z",
  handoffVersion: 2, taskUpdatedAt: "2026-10-01T00:00:00.000Z",
  taskSnapshot: {
    title: "task", status: "in_progress", priority: "medium", dueDate: null, assigneeId: null, assigneeName: null,
    description: null, handoffBrief: null, doneCriteria: [], requiredEvidence: [], responseDueAt: null,
    completionNote: null, committedHandoffVersion: null,
  },
  repository: {
    key: "local:/Users/alice/private-project", headSha: "a".repeat(40), branch: "feature/private",
    dirty: true, dirtyPolicy: "excluded", recoveryBlockers: ["dirty files excluded"],
  },
  session: {
    provider: "Entire CLI", providerVersion: "0.11.3", sessionId: "private-session-id", checkpointId: "private-provider-id",
    captureMode: "context-only",
  },
  handoff: {
    goal: "修复同步", completed: ["已记录进度"], remaining: ["验证接口"], blocker: null,
    rejectedApproaches: ["不要公开此私有实现"], nextAction: "运行测试",
  },
  tests: [],
  artifacts: [{
    id: "d87c4e10-09d1-40d6-9e55-62bc029940b9", kind: "transcript", relativePath: "artifacts/private.transcript", byteLength: 30,
    sha256: "b".repeat(64),
  }],
};

describe("checkpoint publish payload", () => {
  it("shares only the approved summary, SHA, scope, and material metadata", () => {
    const payload = toCheckpointIndexPayload(manifest, "project", null);
    const serialized = JSON.stringify(payload);
    expect(payload.visibility).toBe("project");
    expect(payload.headSha).toBe(manifest.repository.headSha);
    expect(payload.materials).toEqual([{
      id: "d87c4e10-09d1-40d6-9e55-62bc029940b9", kind: "transcript", sha256: "b".repeat(64), byteLength: 30, transferred: false,
    }]);
    expect(serialized).not.toContain("private-project");
    expect(serialized).not.toContain("feature/private");
    expect(serialized).not.toContain("private-session-id");
    expect(serialized).not.toContain("private-provider-id");
    expect(serialized).not.toContain("private.transcript");
    expect(serialized).not.toContain("不要公开");
    expect(serialized).not.toContain("dirty files");
  });

  it("rejects an existing mapping whose remote record has the same project/task but a different summary or SHA", () => {
    const payload = toCheckpointIndexPayload(manifest, "project", null);
    const remote: ServerCheckpoint = {
      id: "d87c4e10-09d1-40d6-9e55-62bc029940b0",
      projectId: manifest.projectId,
      taskId: manifest.taskId,
      creatorId: "d87c4e10-09d1-40d6-9e55-62bc029940b1",
      visibility: "project",
      parentCheckpointId: payload.parentCheckpointId,
      taskHandoffVersion: payload.taskHandoffVersion,
      taskUpdatedAt: payload.taskUpdatedAt,
      repositoryKeyHash: payload.repositoryKeyHash,
      headSha: payload.headSha,
      source: payload.source,
      handoffSummary: payload.handoffSummary,
      materials: payload.materials,
      createdAt: manifest.capturedAt,
    };
    expect(fullCheckpointMatches(remote, manifest.projectId, manifest.taskId, payload)).toBe(true);
    expect(fullCheckpointMatches({ ...remote, headSha: "c".repeat(40) }, manifest.projectId, manifest.taskId, payload)).toBe(false);
    expect(fullCheckpointMatches({
      ...remote,
      handoffSummary: { ...remote.handoffSummary, goal: "另一条摘要" },
    }, manifest.projectId, manifest.taskId, payload)).toBe(false);
    const childPayload = toCheckpointIndexPayload({ ...manifest, parentCheckpointId: "local-parent" }, "project", "server-parent");
    expect(childPayload.parentCheckpointId).toBe("server-parent");
  });
});
