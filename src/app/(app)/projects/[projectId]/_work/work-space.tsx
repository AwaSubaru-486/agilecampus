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

// 工作：任务如何拆分与流转。
//
// 这一模式才查任务明细。任务表是项目里最大的表，只应在真的要看板时读。
// 时间线不在这里渲染（它有独立路由），但给一个入口。

export async function WorkSpace({
  actorId,
  projectId,
  teamId,
  role,
  filters,
}: {
  actorId: string;
  projectId: string;
  teamId: string;
  role: "admin" | "teacher" | "student";
  filters: BoardFilters;
}) {
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

  const canWrite = role === "admin" || role === "student";
  const canReview = role === "admin" || role === "teacher";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">任务</h2>
            <span className="text-xs tabular-nums text-ink-3">{visibleTasks.length} / {projectTasks.length}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">按责任人和状态推进交付</p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <NewTaskForm
              compact
              projectId={projectId}
              members={members}
              milestones={projectMilestones.map((m) => ({ id: m.id, title: m.title }))}
            />
          )}
          <Link href={`/projects/${projectId}/timeline`} className="ac-btn-ghost min-h-8 px-2.5 text-xs">
            时间线
          </Link>
        </div>
      </div>

      <FilterBar
        members={members.map((m) => ({
          id: m.id,
          name: m.kind === "agent" ? `${m.name}（AI）` : m.name,
        }))}
        milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
        labels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
        visible={visibleTasks.length}
        total={projectTasks.length}
      />

      {filters.group === "status" && (
        <p className="text-xs text-ink-3">
          状态由“接手 / 提交 / 验收”推进；拖拽只用于重新分组。
        </p>
      )}

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
          declineReason: t.declineReason,
          // 按任务预先算好，免得把整张状态表穿过三层组件
          agentStatus: t.assigneeId ? (agentStatusById[t.assigneeId] ?? null) : null,
          hasActiveRun: busyTaskIds.has(t.id),
        }))}
        canWrite={canWrite}
        canReview={canReview}
        currentUserId={actorId}
        members={members}
        milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
        allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
        allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
        dependencies={dependencies}
      />
    </section>
  );
}
