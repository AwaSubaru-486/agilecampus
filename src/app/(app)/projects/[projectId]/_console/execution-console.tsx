/**
 * 协同执行台服务端编排器（W02）。
 *
 * 职责：鉴权、按页加载任务列表、加载选中任务详情，向客户端容器传递可序列化摘要。
 * 不直接使用数据库模块；通过 lib/collaboration-console.ts 只读投影查询。
 */

import { notFound } from "next/navigation";
import { z } from "zod";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import {
  listConsoleTasks,
  getConsoleTask,
  getConsoleRun,
} from "@/lib/collaboration-console";
import { toTaskRowModel } from "@/lib/collaboration-console-view";
import { parseRequiredEvidence } from "@/lib/handoff";
import { listTaskAttempts } from "@/lib/checkpoint";
import { listProjectMemories } from "@/lib/project-memory";
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
  const [tasksResult, teamMembersList, milestones] = await Promise.all([
    listConsoleTasks(actorId, projectId, { limit: 50 }),
    listTeamMembers(access.project.teamId),
    listProjectMilestones(actorId, projectId),
  ]);

  // 选中任务详情
  let selectedTask: Awaited<ReturnType<typeof getConsoleTask>> | null = null;
  let selectedTaskError: string | null = null;
  let selectedRun: Awaited<ReturnType<typeof getConsoleRun>> | null = null;
  let selectedRunError: string | null = null;

  if (normalized.task && z.string().uuid().safeParse(normalized.task).success) {
    try {
      selectedTask = await getConsoleTask(actorId, projectId, normalized.task);
    } catch {
      selectedTaskError = "任务不存在或无权访问";
    }
  }

  if (selectedTask && normalized.run) {
    try {
      selectedRun = await getConsoleRun(actorId, projectId, selectedTask.task.id, normalized.run);
    } catch {
      selectedRunError = "运行记录不存在或无权查看";
    }
  }

  let attempts: Awaited<ReturnType<typeof listTaskAttempts>> = [];
  let memories: Awaited<ReturnType<typeof listProjectMemories>> = [];

  if (selectedTask) {
    try {
      const [fetchedAttempts, fetchedMemories] = await Promise.all([
        listTaskAttempts(actorId, projectId, selectedTask.task.id),
        listProjectMemories(actorId, projectId, { taskId: selectedTask.task.id }),
      ]);
      attempts = fetchedAttempts;
      memories = fetchedMemories;
    } catch {
      // 容错处理，不中断主流程
    }
  }

  const serializeRunResult = (result: unknown) => {
    if (result == null) return null;
    try {
      const serialized = JSON.stringify(result, null, 2);
      return serialized.length > 12000 ? `${serialized.slice(0, 12000)}\n…（内容已截断）` : serialized;
    } catch {
      return "运行结果无法显示";
    }
  };

  // 映射为行模型（排序、分组、主动作）
  const actor = { id: actorId, canReview };
  const capabilities = {
    canStartAgentRun: false, // 网页暂无执行接口
    canViewAgentRun: true,
    canViewEvidence: true,
  };

  const taskRows = tasksResult.items.map((t) => ({
    ...toTaskRowModel(
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
    assigneeName: t.assigneeName ?? null,
  }));

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
        assigneeName: r.assigneeName,
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
              requiredEvidence: parseRequiredEvidence(selectedTask.task.requiredEvidence),
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
              runs: selectedTask.runs.items.map((run) => ({
                id: run.id,
                agentId: run.agentId,
                agentName: run.agentName ?? null,
                status: run.status,
                createdAt: run.createdAt.toISOString(),
                startedAt: run.startedAt?.toISOString() ?? null,
                finishedAt: run.finishedAt?.toISOString() ?? null,
              })),
              hasMoreRuns: selectedTask.runs.hasMore,
              runsNextCursor: selectedTask.runs.nextCursor,
              events: selectedTask.events.items.map((event) => ({
                id: event.id,
                type: event.type,
                summary: event.summary,
                actorId: event.actorId ?? null,
                actorName: event.actorName ?? null,
                createdAt: event.createdAt.toISOString(),
              })),
              hasMoreEvents: selectedTask.events.hasMore,
              eventsNextCursor: selectedTask.events.nextCursor,
              selectedRun: selectedRun ? {
                id: selectedRun.id,
                status: selectedRun.status,
                agentId: selectedRun.agentId,
                agentName: selectedRun.agentName ?? null,
                createdAt: selectedRun.createdAt.toISOString(),
                startedAt: selectedRun.startedAt?.toISOString() ?? null,
                finishedAt: selectedRun.finishedAt?.toISOString() ?? null,
                resultPreview: serializeRunResult(selectedRun.result),
                error: selectedRun.error?.slice(0, 8000) ?? null,
              } : null,
              selectedRunError,
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
              attempts: attempts.map((a) => ({
                id: a.id,
                handoffId: a.handoffId,
                actorId: a.actorId,
                actorName: a.actorName ?? null,
                baseSha: a.baseSha,
                branchName: a.branchName ?? null,
                kind: a.kind,
                state: a.state,
                receipt: {
                  sessionId: a.receipt?.sessionId ?? null,
                  headSha: a.receipt?.headSha ?? null,
                  changedPaths: a.receipt?.changedPaths ?? [],
                  tests: (a.receipt?.tests ?? []).map((t) => ({
                    commandLabel: t.commandLabel,
                    exitCode: t.exitCode ?? null,
                    source: t.source,
                  })),
                },
                createdAt: a.createdAt.toISOString(),
                updatedAt: a.updatedAt.toISOString(),
              })),
              memories: memories.map((m) => ({
                id: m.id,
                category: m.category,
                title: m.title,
                content: m.content,
                status: m.status,
                codeRefSha: m.codeRefSha ?? null,
                creatorName: m.creatorName ?? null,
                createdAt: m.createdAt.toISOString(),
              })),
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
      milestones={milestones.map((milestone) => ({ id: milestone.id, title: milestone.title }))}
    />
  );
}
