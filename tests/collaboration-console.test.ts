import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, agentRuns, tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { createAgent } from "@/lib/agent-member";
import { createConversation, persistTurn } from "@/lib/agent/conversation";
import { createApprovalRequests } from "@/lib/approval";
import { createContextPack } from "@/lib/context-pack";
import {
  getConsoleConversation, getConsoleRun, getConsoleTask,
  listConsoleEvents, listConsoleRuns, listConsoleTasks,
} from "@/lib/collaboration-console";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ email: "console-owner@test.local", password: "password123", name: "负责人" });
  const member = await createUser({ email: "console-member@test.local", password: "password123", name: "成员" });
  const team = await createTeam(owner.id, "控制台测试");
  await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "项目 A" });
  return { owner, member, team, project };
}

describe("协同执行台只读投影", () => {
  beforeEach(resetDb);

  it("拒绝非成员，空项目返回真实空页", async () => {
    const { owner, project } = await scene();
    const stranger = await createUser({ email: "stranger@test.local", password: "password123", name: "外部" });
    await expect(listConsoleTasks(stranger.id, project.id)).rejects.toThrow("记录不存在或无权访问");
    expect(await listConsoleTasks(owner.id, project.id)).toEqual({ items: [], hasMore: false, nextCursor: null, canReview: true });
  });

  it("即使有两个项目的权限，也不能交叉读取任务或运行", async () => {
    const { owner, team, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "项目 B" });
    const a = await createTask(owner.id, project.id, { title: "A" });
    const b = await createTask(owner.id, other.id, { title: "B" });
    const agent = await createAgent(owner.id, team.id, { name: "测试 Agent", provider: "test", capabilities: [] });
    const [run] = await db.insert(agentRuns).values({ taskId: b.id, agentId: agent.userId, result: { secret: "private-run" } }).returning();
    await expect(getConsoleTask(owner.id, project.id, b.id)).rejects.toThrow("记录不存在或无权访问");
    await expect(getConsoleRun(owner.id, project.id, a.id, run.id)).rejects.toThrow("记录不存在或无权访问");
    await expect(listConsoleRuns(owner.id, project.id, b.id)).rejects.toThrow("记录不存在或无权访问");
  });

  it("私密会话拒绝队友；公共会话仍须关联当前任务", async () => {
    const { owner, member, project } = await scene();
    const task = await createTask(owner.id, project.id, { title: "目标任务" });
    const other = await createTask(owner.id, project.id, { title: "其他任务" });
    const privateChat = await createConversation(owner.id, project.id, { visibility: "private", taskId: task.id });
    await persistTurn(privateChat.id, "secret question", "secret answer", [], owner.id);
    await expect(getConsoleConversation(member.id, project.id, task.id, privateChat.id)).rejects.toThrow("记录不存在或无权访问");
    expect((await getConsoleConversation(owner.id, project.id, task.id, privateChat.id)).messages).toHaveLength(2);
    const publicChat = await createConversation(owner.id, project.id, { taskId: other.id });
    await expect(getConsoleConversation(member.id, project.id, task.id, publicChat.id)).rejects.toThrow("记录不存在或无权访问");
  });

  it("任务分页不重不漏，摘要查询次数不随任务数量增长", async () => {
    const { owner, project } = await scene();
    await createTask(owner.id, project.id, { title: "第一项" });
    const select = vi.spyOn(db, "select");
    const distinct = vi.spyOn(db, "selectDistinctOn");
    let small = 0;
    try {
      await listConsoleTasks(owner.id, project.id);
      small = select.mock.calls.length + distinct.mock.calls.length;
      // Bulk fixture creation does not exercise task writes; production code remains read-only.
      await db.insert(tasks).values(Array.from({ length: 50 }, (_, i) => ({
        projectId: project.id, createdById: owner.id, title: `任务 ${i}`,
      })));
      select.mockClear(); distinct.mockClear();
      const first = await listConsoleTasks(owner.id, project.id);
      expect(select.mock.calls.length + distinct.mock.calls.length).toBe(small);
      expect(first.items).toHaveLength(50);
      expect(first.hasMore).toBe(true);
      const second = await listConsoleTasks(owner.id, project.id, { cursor: first.nextCursor! });
      expect(second.items).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(51);
      await expect(listConsoleTasks(owner.id, project.id, { cursor: "invalid" })).rejects.toThrow("分页游标无效");
      await expect(listConsoleTasks(owner.id, project.id, { limit: 0 })).rejects.toThrow("分页大小");
    } finally { select.mockRestore(); distinct.mockRestore(); }
  });

  it("运行和事件以时间+ID稳定分页，列表不带正文或日志", async () => {
    const { owner, project, team } = await scene();
    const task = await createTask(owner.id, project.id, { title: "运行任务" });
    const agent = await createAgent(owner.id, team.id, { name: "执行器", provider: "test", capabilities: [] });
    const createdAt = new Date("2026-09-30T00:00:00Z");
    await db.insert(agentRuns).values(Array.from({ length: 31 }, () => ({
      taskId: task.id, agentId: agent.userId, createdAt, status: "failed" as const,
      error: "DO_NOT_LIST_ERROR", result: { toolLog: "DO_NOT_LIST_TOOL_LOG" },
    })));
    const first = await listConsoleRuns(owner.id, project.id, task.id);
    const second = await listConsoleRuns(owner.id, project.id, task.id, { cursor: first.nextCursor! });
    expect(first.items).toHaveLength(30);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(31);
    expect(JSON.stringify(first)).not.toContain("DO_NOT_LIST");
    expect((await getConsoleRun(owner.id, project.id, task.id, first.items[0].id)).error).toBe("DO_NOT_LIST_ERROR");
    const rows = await listConsoleTasks(owner.id, project.id);
    expect(rows.items[0].priorityGroup).toBe("blocked");
    expect(JSON.stringify(rows)).not.toContain("DO_NOT_LIST");
    await db.insert(activityEvents).values(Array.from({ length: 31 }, () => ({
      projectId: project.id, taskId: task.id, type: "task_updated" as const, createdAt,
      payload: { toolLog: "DO_NOT_LIST_EVENT_PAYLOAD" },
    })));
    const events = await listConsoleEvents(owner.id, project.id, task.id);
    const more = await listConsoleEvents(owner.id, project.id, task.id, { cursor: events.nextCursor! });
    expect(events.items).toHaveLength(30);
    expect(new Set([...events.items, ...more.items].map((row) => row.id)).size).toBe(32); // plus task_created
    expect(JSON.stringify(events)).not.toContain("DO_NOT_LIST");
    await expect(listConsoleEvents(owner.id, project.id, task.id, { cursor: first.nextCursor! })).rejects.toThrow("分页游标无效");
  });

  it("选中任务只包含其可见审批，私密上下文不泄漏且启动能力关闭", async () => {
    const { owner, member, project } = await scene();
    const task = await createTask(owner.id, project.id, { title: "带上下文任务" });
    const chat = await createConversation(owner.id, project.id, { taskId: task.id, visibility: "private" });
    const turn = await persistTurn(chat.id, "隐私", "草案", [], owner.id);
    await createApprovalRequests(owner.id, project.id, chat.id, turn.assistantMessage!.id,
      [{ __draft: true, tool: "create_milestone", draft: { title: "私密里程碑" } }]);
    const pack = await createContextPack(owner.id, project.id, {
      title: "私密上下文", taskId: task.id, conversationId: chat.id, status: "frozen",
      sources: [{ sourceType: "conversation", sourceId: chat.id }],
    });
    await db.update(tasks).set({ contextPackId: pack.pack.id }).where(eq(tasks.id, task.id));
    const memberView = await getConsoleTask(member.id, project.id, task.id);
    expect(memberView.context).toBeNull();
    expect(memberView.contextUnavailable).toBe(true);
    expect(memberView.approvals).toEqual([]);
    expect(memberView.conversations).toEqual([]);
    expect(memberView.availablePacks).toEqual([]);
    expect(memberView.capabilities.canStartAgentRun).toBe(false);
    const ownerView = await getConsoleTask(owner.id, project.id, task.id);
    expect(ownerView.context?.pack.status).toBe("frozen");
    expect(ownerView.approvals).toHaveLength(1);
    expect(ownerView.approvals[0]).not.toHaveProperty("payload");
    expect(ownerView.conversations).toHaveLength(1);
    expect(ownerView.conversations[0].id).toBe(chat.id);
    expect(ownerView.availablePacks).toHaveLength(1);
    expect(ownerView.availablePacks[0].id).toBe(pack.pack.id);
    const other = await createTask(owner.id, project.id, { title: "无关任务" });
    expect((await getConsoleTask(owner.id, project.id, other.id)).approvals).toEqual([]);
  });
});
