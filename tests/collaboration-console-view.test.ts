import { describe, expect, it } from "vitest";
import {
  agentRunStatusLabel,
  sortTaskRows,
  sortTaskRuns,
  taskPrimaryAction,
  taskPriorityGroup,
  taskStatusLabel,
  toTaskRowModel,
  type ConsoleActor,
  type ConsoleCapabilities,
  type ConsoleTaskInput,
} from "@/lib/collaboration-console-view";

const actor: ConsoleActor = { id: "human-1", canReview: true };
const noReviewActor: ConsoleActor = { id: "human-1", canReview: false };
const capabilities: ConsoleCapabilities = {
  canStartAgentRun: true,
  canViewAgentRun: true,
  canViewEvidence: true,
};

function task(overrides: Partial<ConsoleTaskInput> = {}): ConsoleTaskInput {
  return {
    id: "task-1",
    title: "任务",
    status: "doing",
    assigneeId: "human-1",
    assigneeKind: "human",
    dueDate: null,
    priority: "medium",
    sortOrder: 1,
    committedAt: new Date("2026-09-30T08:00:00Z"),
    committedHandoffVersion: 1,
    handoffVersion: 1,
    openBlockerCount: 0,
    agentRuns: [],
    ...overrides,
  };
}

describe("collaboration console view rules", () => {
  it("待验收且当前用户有权限时排在第一组", () => {
    expect(taskPriorityGroup(task({ status: "review" }), actor)).toBe("awaiting_review");
    expect(taskPriorityGroup(task({ status: "review" }), noReviewActor)).toBe("todo");
  });

  it("阻塞优先于进行中，但不会改变任务状态", () => {
    const blocked = task({ status: "doing", openBlockerCount: 1 });
    expect(taskPriorityGroup(blocked, actor)).toBe("blocked");
    expect(blocked.status).toBe("doing");
  });

  it("我的进行中和其他人的进行中分开", () => {
    expect(taskPriorityGroup(task({ assigneeId: actor.id }), actor)).toBe("my_active");
    expect(taskPriorityGroup(task({ assigneeId: "human-2" }), actor)).toBe("active");
  });

  it("待办和已完成在行动组末尾", () => {
    expect(taskPriorityGroup(task({ status: "todo" }), actor)).toBe("todo");
    expect(taskPriorityGroup(task({ status: "done" }), actor)).toBe("done");
  });

  it("queued 属于活动运行，不能显示暂无执行记录", () => {
    const row = toTaskRowModel(
      task({
        agentRuns: [{ id: "run-1", status: "queued", createdAt: "2026-09-30T10:00:00Z" }],
      }),
      actor,
      capabilities,
    );
    expect(row.activeRun?.status).toBe("queued");
    expect(row.agentRunStatusLabel).toBe("排队中");
    expect(row.primaryAction).toBe("view_run");
  });

  it("没有运行时明确显示暂无执行记录", () => {
    const row = toTaskRowModel(task(), actor, capabilities);
    expect(row.latestRun).toBeNull();
    expect(row.agentRunStatusLabel).toBe("暂无执行记录");
  });

  it("失败只显示查看错误，不虚构重跑能力", () => {
    const input = task({
      agentRuns: [{ id: "run-failed", status: "failed", createdAt: "2026-09-30T10:00:00Z" }],
    });
    expect(taskPrimaryAction(input, actor, capabilities)).toBe("view_error");
  });

  it("completed 只显示证据，任务仍可保持 doing", () => {
    const input = task({
      status: "doing",
      agentRuns: [{ id: "run-done", status: "completed", createdAt: "2026-09-30T10:00:00Z" }],
    });
    expect(taskPrimaryAction(input, actor, capabilities)).toBe("view_evidence");
    expect(input.status).toBe("doing");
  });

  it("没有已提交且版本一致的交接契约时不显示开始 Agent", () => {
    const input = task({ committedAt: null, committedHandoffVersion: null });
    expect(taskPrimaryAction(input, actor, capabilities)).toBe("view_task");
  });

  it("同一时间按 id 稳定排序，避免列表抖动", () => {
    const rows = sortTaskRuns([
      { id: "run-b", status: "failed", createdAt: "2026-09-30T10:00:00Z" },
      { id: "run-a", status: "failed", createdAt: "2026-09-30T10:00:00Z" },
    ]);
    expect(rows.map((run) => run.id)).toEqual(["run-a", "run-b"]);
  });

  it("活动运行优先于较新的失败历史", () => {
    const rows = sortTaskRuns([
      { id: "run-failed", status: "failed", createdAt: "2026-09-30T12:00:00Z" },
      { id: "run-running", status: "running", createdAt: "2026-09-30T09:00:00Z" },
    ]);
    expect(rows[0]?.id).toBe("run-running");
  });

  it("任务列表先按行动组，再按优先级", () => {
    const models = [
      toTaskRowModel(task({ id: "todo", status: "todo", priority: "urgent" }), actor, capabilities),
      toTaskRowModel(task({ id: "review", status: "review", priority: "low" }), actor, capabilities),
      toTaskRowModel(task({ id: "blocked", openBlockerCount: 1, priority: "medium" }), actor, capabilities),
    ];
    expect(sortTaskRows(models).map((row) => row.id)).toEqual(["review", "blocked", "todo"]);
  });

  it("未知状态不当作成功或活动", () => {
    expect(taskStatusLabel("mystery")).toBe("未知状态");
    expect(agentRunStatusLabel("mystery")).toBe("未知状态");
    expect(
      toTaskRowModel(task({ status: "mystery" }), actor, capabilities).primaryAction,
    ).toBe("view_task");
  });
});
