/**
 * 协同执行台服务端编排器（W02）。
 *
 * 职责：鉴权、按页加载任务列表、加载选中任务详情，向客户端容器传递可序列化摘要。
 * 不直接使用数据库模块；通过 lib/collaboration-console.ts 只读投影查询。
 */

import { notFound } from "next/navigation";
import { z } from "zod";
import { getProjectForUser } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import {
  listConsoleTasks,
  getConsoleTask,
} from "@/lib/collaboration-console";
import { toTaskRowModel } from "@/lib/collaboration-console-view";
import { ConsoleShell } from "./console-shell";
import type { NormalizedConsoleParams } from "@/lib/console-navigation";

export async function ExecutionConsole({
  actorId,
  projectId,
  role,
  normalized,
}: {
  actorId: string;
  projectId: string;
  role: "admin" | "teacher" | "student";
  normalized: NormalizedConsoleParams;
}) {
  // 再次鉴权（page.tsx 已鉴，此处作防御）
  if (!z.string().uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(actorId, projectId);
  if (!access) notFound();

  const canReview = role === "admin" || role === "teacher";
  const canWrite = role === "admin" || role === "student";

  // 分页加载任务列表与团队成员
  const [tasksResult, teamMembersList] = await Promise.all([
    listConsoleTasks(actorId, projectId, { limit: 50 }),
    listTeamMembers(access.project.teamId),
  ]);

  // 选中任务详情
  let selectedTask: Awaited<ReturnType<typeof getConsoleTask>> | null = null;
  let selectedTaskError: string | null = null;

  if (normalized.task && z.string().uuid().safeParse(normalized.task).success) {
    try {
      selectedTask = await getConsoleTask(actorId, projectId, normalized.task);
    } catch {
      selectedTaskError = "任务不存在或无权访问";
    }
  }

  // 映射为行模型（排序、分组、主动作）
  const actor = { id: actorId, canReview };
  const capabilities = {
    canStartAgentRun: false, // 网页暂无执行接口
    canViewAgentRun: true,
    canViewEvidence: true,
  };

  const taskRows = tasksResult.items.map((t) =>
    toTaskRowModel(
      {
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeId: t.assigneeId,
        assigneeKind: (t.assigneeKind as import("@/lib/collaboration-console-view").AssigneeKind | null) ?? "unknown",
        dueDate: t.dueDate ?? null,
        priority: t.priority,
        sortOrder: t.sortOrder,
        committedAt: t.committedAt ?? null,
        committedHandoffVersion: t.committedHandoffVersion ?? null,
        handoffVersion: t.handoffVersion ?? null,
        openBlockerCount: (t as unknown as { openBlockerCount?: number }).openBlockerCount ?? 0,
        agentRuns: (t as unknown as { agentRuns?: { id: string; status: string; createdAt: Date | string }[] }).agentRuns ?? [],
      },
      actor,
      capabilities,
    ),
  );

  return (
    <ConsoleShell
      projectId={projectId}
      actorId={actorId}
      canWrite={canWrite}
      canReview={canReview}
      taskRows={taskRows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        assigneeId: r.assigneeId,
        assigneeName: (r as unknown as { assigneeName?: string | null }).assigneeName ?? null,
        dueDate: r.dueDate ?? null,
        taskStatusLabel: r.taskStatusLabel,
        agentRunStatusLabel: r.agentRunStatusLabel,
        priorityGroup: r.priorityGroup,
        primaryAction: r.primaryAction,
        activeRun: r.activeRun
          ? { id: r.activeRun.id, status: r.activeRun.status }
          : null,
        openBlockerCount: r.openBlockerCount,
        handoffVersion: r.handoffVersion,
        committedAt: r.committedAt ? new Date(r.committedAt).toISOString() : null,
      }))}
      hasMore={tasksResult.hasMore}
      nextCursor={tasksResult.nextCursor}
      selectedTaskId={normalized.task}
      selectedTask={
        selectedTask
          ? {
              id: selectedTask.task.id,
              title: selectedTask.task.title,
              status: selectedTask.task.status,
              assigneeId: selectedTask.task.assigneeId ?? null,
              assigneeName: selectedTask.task.assigneeName ?? null,
              dueDate: selectedTask.task.dueDate ?? null,
              description: selectedTask.task.description ?? null,
              handoffBrief: selectedTask.task.handoffBrief ?? null,
              doneCriteria: (selectedTask.task.doneCriteria as string[] | null) ?? null,
              requiredEvidence: selectedTask.task.requiredEvidence as string | null ?? null,
              responseDueAt: selectedTask.task.responseDueAt
                ? new Date(selectedTask.task.responseDueAt).toISOString()
                : null,
              handoffVersion: selectedTask.task.handoffVersion,
              committedHandoffVersion: selectedTask.task.committedHandoffVersion ?? null,
              committedAt: selectedTask.task.committedAt
                ? new Date(selectedTask.task.committedAt).toISOString()
                : null,
              contextPackId: selectedTask.task.contextPackId ?? null,
              contextUnavailable: selectedTask.contextUnavailable,
              // ContextPackView: { pack, items, stale } — pack has title/status/frozenAt
              contextTitle: selectedTask.context?.pack.title ?? null,
              contextFrozen: selectedTask.context ? selectedTask.context.pack.status === "frozen" : null,
              contextFrozenAt: selectedTask.context?.pack.frozenAt
                ? new Date(selectedTask.context.pack.frozenAt).toISOString()
                : null,
              contextStale: selectedTask.context?.stale ?? null,
              runsCount: selectedTask.runs.items.length,
              hasMoreRuns: selectedTask.runs.hasMore,
              eventsCount: selectedTask.events.items.length,
              approvals: selectedTask.approvals.map((a) => ({
                id: a.id,
                title: a.title,
                status: a.status,
                canResolve: a.canResolve,
              })),
              capabilities: selectedTask.capabilities,
              evidence: selectedTask.evidence.map((e) => ({
                id: e.id,
                type: e.type,
                title: e.label,
                description: e.value,
                url: e.type === "link" ? e.value : null,
                submittedAt: e.createdAt.toISOString(),
              })),
              conversations: selectedTask.conversations,
              availablePacks: selectedTask.availablePacks,
            }
          : null
      }
      selectedTaskError={selectedTaskError}
      mode={normalized.space === "studio" ? "studio" : "work"}
      members={teamMembersList.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        kind: m.kind,
      }))}
    />
  );
}
