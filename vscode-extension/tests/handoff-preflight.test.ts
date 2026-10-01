import { describe, expect, it } from "vitest";
import { evaluateHandoffPreflight } from "../src/handoff/preflight";
import type { WorkCheckpoint } from "../src/checkpoints/types";
import type { TaskDetail } from "../src/types";
import type { RepositorySnapshot } from "../src/git/repository-service";

const sha = "a".repeat(40);
function checkpoint(): WorkCheckpoint {
  return {
    schemaVersion: 1, id: "d87c4e10-09d1-40d6-9e55-62bc029940b9", parentCheckpointId: null,
    serverOrigin: "https://agilecampus.example/", projectId: "project-a", taskId: "task-a", milestoneId: null,
    capturedAt: "2026-10-01T06:00:00.000Z", handoffVersion: 2, taskUpdatedAt: "2026-10-01T05:00:00.000Z",
    taskSnapshot: {
      title: "验证恢复", status: "doing", priority: "high", dueDate: "2026-10-08T00:00:00.000Z", assigneeId: "member-a", assigneeName: "A",
      description: "确认 SHA", handoffBrief: "不要覆盖文件", doneCriteria: ["SHA 一致"], requiredEvidence: ["测试日志"],
      responseDueAt: null, completionNote: null, committedHandoffVersion: 2,
    },
    repository: { key: "remote:repo-a", headSha: sha, branch: "main", dirty: false, dirtyPolicy: "clean-only", recoveryBlockers: [] },
    session: { provider: "Entire CLI", providerVersion: "0.11.3", sessionId: null, checkpointId: null, captureMode: "context-only" },
    handoff: { goal: "验证恢复", completed: [], remaining: ["测试"], blocker: null, rejectedApproaches: [], nextAction: "运行测试" },
    tests: [], artifacts: [],
  };
}
function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "task-a", projectId: "project-a", title: "验证恢复", status: "doing", priority: "high", dueDate: "2026-10-08T00:00:00.000Z",
    assigneeId: "member-a", assigneeName: "A", handoffBrief: "不要覆盖文件", doneCriteria: ["SHA 一致"],
    requiredEvidence: ["测试日志"], updatedAt: "2026-10-01T05:00:00.000Z", description: "确认 SHA",
    completionNote: null, responseDueAt: null, handoffVersion: 2, committedHandoffVersion: 2,
    ...overrides,
  };
}
function repository(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return { rootPath: "/repo", key: "remote:repo-a", headSha: sha, branch: "main", dirty: false, recoveryBlockers: [], ...overrides };
}
function evaluate(overrides: Partial<Parameters<typeof evaluateHandoffPreflight>[0]> = {}) {
  return evaluateHandoffPreflight({
    workspaceTrusted: true, projectId: "project-a", checkpoint: checkpoint(), task: task(), taskAccessible: true,
    repository: repository(), materialSummary: [{ kind: "context", byteLength: 12 }], checkpointCommitAvailable: true, confirmedChangedTask: false, ...overrides,
  });
}

describe("checkpoint handoff preflight", () => {
  it("prepares context-only plan only when task, SHA, repo and worktree match", () => {
    expect(evaluate()).toMatchObject({ status: "ready", plan: { baseSha: sha, mode: "context-only", executesAgent: false } });
  });

  it("shows field-level task changes and requires explicit confirmation", () => {
    const changed = task({ handoffBrief: "新要求", doneCriteria: ["另一个条件"], updatedAt: "2026-10-01T07:00:00.000Z", handoffVersion: 3 });
    expect(evaluate({ task: changed })).toMatchObject({ status: "needs-confirmation", changes: expect.arrayContaining([
      { field: "交接要求", saved: "不要覆盖文件", current: "新要求" },
      { field: "交接契约版本", saved: "2", current: "3" },
    ]) });
    expect(evaluate({ task: changed, confirmedChangedTask: true })).toMatchObject({ status: "ready", plan: { handoffVersion: 3 } });
  });

  it("blocks untrusted, inaccessible, mismatched and completed tasks", () => {
    expect(evaluate({ workspaceTrusted: false })).toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringContaining("不受信任")]) });
    expect(evaluate({ taskAccessible: false })).toMatchObject({ status: "blocked" });
    expect(evaluate({ projectId: "other" })).toMatchObject({ status: "blocked" });
    expect(evaluate({ task: task({ status: "done" }) })).toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringContaining("验收完成")]) });
  });

  it("blocks dirty worktree, wrong repository, wrong HEAD and missing commit", () => {
    expect(evaluate({ repository: repository({ dirty: true }) })).toMatchObject({ status: "blocked" });
    expect(evaluate({ repository: repository({ key: "remote:other" }) })).toMatchObject({ status: "blocked" });
    expect(evaluate({ repository: repository({ headSha: "b".repeat(40) }) })).toMatchObject({ status: "blocked" });
    expect(evaluate({ checkpointCommitAvailable: false })).toMatchObject({ status: "blocked" });
  });

  it("blocks submodule/LFS and inconsistent dirty policy", () => {
    expect(evaluate({ repository: repository({ recoveryBlockers: ["Git LFS content is unavailable"] }) })).toMatchObject({ status: "blocked" });
    const invalid = checkpoint();
    invalid.repository.dirty = true;
    invalid.repository.dirtyPolicy = "clean-only";
    expect(evaluate({ checkpoint: invalid })).toMatchObject({ status: "blocked" });
  });

  it("keeps unknown session adapter versions context-only and warns instead of native resume", () => {
    const item = checkpoint();
    item.session.providerVersion = "future-version";
    expect(evaluate({ checkpoint: item })).toMatchObject({ status: "ready", plan: { mode: "context-only", executesAgent: false }, warnings: [
      expect.stringContaining("仅支持携带已选材料"), expect.stringContaining("未通过本地 adapter 核验"),
    ] });
  });

  it("changes task fingerprint even if a service failed to advance updatedAt", () => {
    const before = evaluate({ confirmedChangedTask: true });
    const after = evaluate({ task: task({ title: "Edited title" }), confirmedChangedTask: true });
    expect(before.status).toBe("ready");
    expect(after.status).toBe("ready");
    if (before.status === "ready" && after.status === "ready") {
      expect(after.plan.taskFingerprint).not.toBe(before.plan.taskFingerprint);
    }
  });
});
