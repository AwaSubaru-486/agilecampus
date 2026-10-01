"use client";

/**
 * 协同执行台客户端容器（W02）。
 *
 * 布局规则（工单 §3.2）：
 *   ≥1120px  三栏（280 / 剩余 / 320）
 *   760–1119  任务+详情；执行记录通过"执行记录"按钮打开抽屉
 *   <760     列表与详情二选一；panel=list 时显示列表
 *
 * 客户端只接收可序列化摘要，不 import 数据库模块。
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { TaskPriorityGroup, TaskAction } from "@/lib/collaboration-console-view";
import { buildSelectTaskHref, buildClearTaskHref, type NormalizedConsoleParams } from "@/lib/console-navigation";
import { TaskList } from "./task-list";
import { TaskContractPanel } from "./task-contract-panel";
import { AgentRunRail } from "./agent-run-rail";

export type TaskRowSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  taskStatusLabel: string;
  agentRunStatusLabel: string;
  priorityGroup: TaskPriorityGroup;
  primaryAction: TaskAction;
  activeRun: { id: string; status: string } | null;
  openBlockerCount: number;
  handoffVersion: number | null;
  committedAt: string | null;
};

export type SelectedTaskDetail = {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  description: string | null;
  handoffBrief: string | null;
  doneCriteria: string[] | null;
  requiredEvidence: string | null;
  responseDueAt: string | null;
  handoffVersion: number;
  committedHandoffVersion: number | null;
  committedAt: string | null;
  contextPackId: string | null;
  contextUnavailable: boolean;
  contextTitle: string | null;
  contextFrozen: boolean | null;
  contextFrozenAt: string | null;
  contextStale: boolean | null;
  runsCount: number;
  hasMoreRuns: boolean;
  eventsCount: number;
  approvals: { id: string; title: string; status: string; canResolve: boolean }[];
  capabilities: { canStartAgentRun: boolean; canResumeAgentRun: boolean; canStopAgentRun: boolean };
  evidence: {
    id: string;
    type: string;
    title: string;
    description?: string | null;
    url?: string | null;
    submittedAt?: string | null;
    submitterName?: string | null;
  }[];
  conversations?: {
    id: string;
    title?: string | null;
    updatedAt?: string | null;
  }[];
  availablePacks?: {
    id: string;
    title: string;
    frozenAt?: string | null;
  }[];
};

export type MemberSummary = {
  id: string;
  name: string;
  role: string;
  kind: string;
};

export function ConsoleShell({
  projectId,
  actorId,
  canWrite,
  canReview,
  taskRows,
  hasMore,
  nextCursor,
  selectedTaskId,
  selectedTask,
  selectedTaskError,
  mode = "work",
  members = [],
}: {
  projectId: string;
  actorId: string;
  canWrite: boolean;
  canReview: boolean;
  taskRows: TaskRowSummary[];
  hasMore: boolean;
  nextCursor: string | null;
  selectedTaskId: string | null;
  selectedTask: SelectedTaskDetail | null;
  selectedTaskError: string | null;
  mode?: "work" | "studio";
  members?: MemberSummary[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // 10秒定时刷新：仅在存在活动运行时生效，并在前台可见时触发，不使用 POST 轮询（W03 §8）
  useEffect(() => {
    const hasActiveRun = taskRows.some((t) => Boolean(t.activeRun));
    if (!hasActiveRun) return;

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        router.refresh();
      }
    }, 10000);

    return () => clearInterval(timer);
  }, [taskRows, router]);

  // 窄屏：panel=list 时强制显示列表，否则显示详情
  const panel = searchParams.get("panel");
  const showListOnNarrow = !selectedTaskId || panel === "list";

  // 构造当前 NormalizedConsoleParams（仅需筛选参数，用于 buildSelectTaskHref）
  const currentParams: NormalizedConsoleParams = {
    space: mode === "studio" ? "studio" : "work",
    task: selectedTaskId,
    conversation: null,
    approval: null,
    run: searchParams.get("run"),
    panel: panel,
    assignee: searchParams.get("assignee"),
    priority: searchParams.get("priority"),
    label: searchParams.get("label"),
    milestone: searchParams.get("milestone"),
    overdue: searchParams.get("overdue"),
    group: searchParams.get("group"),
  };

  // 桌面端无显式选中任务时，默认选当前页排序最前的待处理任务（用 replace 补入 URL，W01/W02）
  useEffect(() => {
    if (!selectedTaskId && taskRows.length > 0 && typeof window !== "undefined" && window.innerWidth >= 1120) {
      const firstPending = taskRows.find((t) => t.status !== "done") ?? taskRows[0];
      router.replace(buildSelectTaskHref(projectId, firstPending.id, currentParams));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, taskRows, projectId]);

  function selectTask(taskId: string) {
    startTransition(() => {
      router.push(buildSelectTaskHref(projectId, taskId, currentParams));
    });
  }

  function clearTask() {
    startTransition(() => {
      router.push(buildClearTaskHref(projectId, currentParams));
    });
  }

  // 执行记录抽屉（中等宽度使用）
  const [runRailOpen, setRunRailOpen] = useState(false);

  return (
    <div className="relative flex min-h-0 w-full flex-col">
      {/* 桌面/平板三栏或双栏容器 */}
      <div className="flex min-h-0 flex-1 divide-x divide-stroke overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">

        {/* ── 左栏：任务列表 ── */}
        <div
          className={[
            "flex w-full flex-col overflow-y-auto xl:w-[280px] xl:shrink-0",
            // 窄屏：选中任务时隐藏列表，除非 panel=list
            selectedTaskId && !showListOnNarrow ? "hidden xl:flex" : "flex",
          ].join(" ")}
        >
          <TaskList
            projectId={projectId}
            taskRows={taskRows}
            hasMore={hasMore}
            nextCursor={nextCursor}
            selectedTaskId={selectedTaskId}
            canWrite={canWrite}
            mode={mode}
            onSelectTask={selectTask}
          />
        </div>

        {/* ── 中栏：交接工作面 ── */}
        <div
          className={[
            "min-w-0 flex-1 overflow-y-auto",
            // 窄屏：有选中任务且不是列表面板时显示
            selectedTaskId && !showListOnNarrow ? "flex flex-col" : "hidden xl:flex xl:flex-col",
          ].join(" ")}
        >
          <TaskContractPanel
            projectId={projectId}
            actorId={actorId}
            canWrite={canWrite}
            canReview={canReview}
            selectedTask={selectedTask}
            selectedTaskError={selectedTaskError}
            selectedTaskId={selectedTaskId}
            members={members}
            onBack={clearTask}
            onOpenRunRail={() => setRunRailOpen(true)}
          />
        </div>

        {/* ── 右栏：执行记录（≥1120px 固定显示；<1120px 抽屉） ── */}
        <div className="hidden w-[320px] shrink-0 flex-col overflow-y-auto min-[1120px]:flex">
          <AgentRunRail
            projectId={projectId}
            actorId={actorId}
            selectedTask={selectedTask}
            drawerMode={false}
          />
        </div>
      </div>

      {/* 执行记录抽屉（<1120px） */}
      {runRailOpen && (
        <div className="fixed inset-0 z-50 flex justify-end min-[1120px]:hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-ink/20"
            onClick={() => setRunRailOpen(false)}
          />
          <div className="relative flex h-full w-full max-w-sm flex-col overflow-y-auto bg-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-stroke px-4 py-3">
              <span className="text-sm font-medium text-ink">执行记录</span>
              <button
                onClick={() => setRunRailOpen(false)}
                className="ac-pressable rounded p-1 text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                aria-label="关闭执行记录"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AgentRunRail
                projectId={projectId}
                actorId={actorId}
                selectedTask={selectedTask}
                drawerMode
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
