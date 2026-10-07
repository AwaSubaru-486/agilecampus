import Link from "next/link";
import { listProjectAgents } from "@/lib/agent-member";
import { listBusyTaskIds } from "@/lib/agent-run";
import { applyFilters, type BoardFilters } from "@/lib/board-filters";
import { listTeamLabels } from "@/lib/label";
import { listProjectMilestones } from "@/lib/project";
import { listProjectDependencies, listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { today } from "@/lib/today";
import { Board } from "../board";
import { FilterBar } from "../filter-bar";
import { NewTaskForm } from "../new-task-form";
import { ExecutionConsole } from "../_console/execution-console";
import type { NormalizedConsoleParams } from "@/lib/console-navigation";

// 工作：任务如何拆分与流转。
//
// W02 变更：space=work 默认进入协同执行台（三栏交接工作面）。
// 原看板通过 ?view=board 访问，保留所有能力，不静默删除。
// 时间线保留独立路由入口。

export async function WorkSpace({
  actorId,
  projectId,
  teamId,
  role,
  filters,
  selectedTaskId,
  view,
  normalized,
}: {
  actorId: string;
  projectId: string;
  teamId: string;
  role: "admin" | "teacher" | "student";
  filters: BoardFilters;
  /** W01: ?task= 选中的任务 ID，由 page.tsx 经 normalizeConsoleParams 传入 */
  selectedTaskId?: string | null;
  /** ?view=board 时显示旧看板 */
  view?: string | null;
  /** W02: 完整规范化参数，传给执行台 */
  normalized?: NormalizedConsoleParams;
}) {
  const canWrite = role === "admin" || role === "student";
  const canReview = role === "admin" || role === "teacher";
  const canCreateTask = role === "admin";

  // 看板模式：需要完整任务数据
  if (view === "board") {
    const [projectTasks, projectMilestones, members, dependencies, teamLabels, projectAgents, busyTaskIds] =
      await Promise.all([
        listProjectTasks(actorId, projectId),
        listProjectMilestones(actorId, projectId),
        listTeamMembers(teamId),
        listProjectDependencies(actorId, projectId),
        listTeamLabels(actorId, teamId),
        listProjectAgents(actorId, projectId),
        listBusyTaskIds(projectId),
      ]);

    const agentStatusById = Object.fromEntries(projectAgents.map((a) => [a.userId, a.status]));
    const visibleTasks = applyFilters(projectTasks, filters, today());
    const members_ = members;
    const projectMilestones_ = projectMilestones;

    return (
      <section data-tour="task-board" className="space-y-3">
        {/* 看板工具栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke pb-3">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">看板</h2>
            <span className="text-xs tabular-nums text-ink-3">
              显示 {visibleTasks.length} 项，共 {projectTasks.length} 项
            </span>
          </div>
          <div className="flex items-center gap-2">
            <nav aria-label="任务视图" className="ac-view-switch !mt-0">
              <Link href={`/projects/${projectId}?space=work&panel=list`}>列表</Link>
              <Link href={`/projects/${projectId}?space=work&view=board`} aria-current="page">看板</Link>
            </nav>
            {canCreateTask && (
              <NewTaskForm
                compact
                projectId={projectId}
                members={members_}
                milestones={projectMilestones_.map((m) => ({ id: m.id, title: m.title }))}
              />
            )}

          </div>
        </div>

        <details className="ac-disclosure" open={Boolean(filters.assignee || filters.priority || filters.label || filters.milestone || filters.overdue)}>
          <summary>筛选与分组</summary>
          <div className="ac-disclosure-body">
        <FilterBar
          members={members_.map((m) => ({
            id: m.id,
            name: m.kind === "agent" ? `${m.name}（AI）` : m.name,
          }))}
          milestones={projectMilestones_.map((m) => ({ id: m.id, name: m.title }))}
          labels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          visible={visibleTasks.length}
          total={projectTasks.length}
        />
          </div>
        </details>

        <Board
          projectId={projectId}
          groupBy={filters.group}
          tasks={visibleTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            completionNote: t.completionNote,
            status: t.status,
            priority: t.priority,
            startDate: t.startDate,
            dueDate: t.dueDate,
            assigneeName: t.assigneeName,
            assigneeId: t.assigneeId,
            milestoneId: t.milestoneId,
            labels: t.labels,
            commitmentNote: t.commitmentNote,
            estimatedHours: t.estimatedHours,
            reviewNote: t.reviewNote,
            committedAt: t.committedAt,
            handoffVersion: t.handoffVersion,
            committedHandoffVersion: t.committedHandoffVersion,
            requiredEvidence: t.requiredEvidence,
            evidenceTypes: t.evidenceTypes,
            declineReason: t.declineReason,
            agentStatus: t.assigneeId ? (agentStatusById[t.assigneeId] ?? null) : null,
            hasActiveRun: busyTaskIds.has(t.id),
          }))}
          canWrite={canWrite}
          canReview={canReview}
          currentUserId={actorId}
          members={members_}
          milestones={projectMilestones_.map((m) => ({ id: m.id, name: m.title }))}
          allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
          allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          dependencies={dependencies}
        />
      </section>
    );
  }

  // 默认：协同执行台
  const defaultNormalized: NormalizedConsoleParams = normalized ?? {
    space: "work",
    task: selectedTaskId ?? null,
    conversation: null,
    approval: null,
    run: null,
    panel: null,
    assignee: null,
    priority: null,
    label: null,
    milestone: null,
    overdue: null,
    group: null,
  };

  return (
    <section data-tour="execution-console" className="flex flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-3">{role === "teacher" ? "选择待验收任务，检查证据后给出反馈。" : "选择一项任务，查看要求、接下工作或提交成果。"}</p>
        <nav aria-label="任务视图" className="ac-view-switch !mt-0">
          <Link href={`/projects/${projectId}?space=work&panel=list`} aria-current="page">列表</Link>
          <Link href={`/projects/${projectId}?space=work&view=board`}>看板</Link>
        </nav>
      </div>

      {/* 执行台：三栏交接工作面 */}
      <ExecutionConsole
        actorId={actorId}
        projectId={projectId}
        role={role}
        normalized={defaultNormalized}
      />
    </section>
  );
}
