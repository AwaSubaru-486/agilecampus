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
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { TaskPriorityGroup, TaskAction } from "@/lib/collaboration-console-view";
import type { EvidenceType } from "@/lib/handoff";
import { buildSelectTaskHref, buildClearTaskHref, type NormalizedConsoleParams } from "@/lib/console-navigation";
import { NewTaskForm } from "../new-task-form";
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

export type ConsoleLayout = "mobile" | "tablet" | "desktop";

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
  requiredEvidence: EvidenceType[] | null;
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
  runs: {
    id: string;
    agentId: string;
    agentName: string | null;
    status: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  }[];
  hasMoreRuns: boolean;
  runsNextCursor: string | null;
  events: {
    id: string;
    type: string;
    summary: string | null;
    actorId: string | null;
    actorName: string | null;
    createdAt: string;
  }[];
  hasMoreEvents: boolean;
  eventsNextCursor: string | null;
  selectedRun: {
    id: string;
    status: string;
    agentId: string;
    agentName: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    resultPreview: string | null;
    error: string | null;
  } | null;
  selectedRunError: string | null;
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
  attempts?: AttemptSummary[];
  memories?: MemorySummary[];
};

export type AttemptSummary = {
  id: string;
  handoffId: string;
  actorId: string;
  actorName: string | null;
  baseSha: string;
  branchName: string | null;
  kind: string;
  state: string;
  receipt: {
    sessionId: string | null;
    headSha: string | null;
    changedPaths: string[];
    tests: Array<{
      commandLabel: string;
      exitCode: number | null;
      source: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
};

export type MemorySummary = {
  id: string;
  category: string;
  title: string;
  content: string;
  status: string;
  codeRefSha: string | null;
  creatorName: string | null;
  createdAt: string;
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
  canCreateTask = false,
  canDeleteTask = false,
  canReview,
  taskRows,
  hasMore,
  nextCursor,
  selectedTaskId,
  selectedTask,
  selectedTaskError,
  mode = "work",
  members = [],
  milestones = [],
}: {
  projectId: string;
  actorId: string;
  canWrite: boolean;
  canCreateTask?: boolean;
  canDeleteTask?: boolean;
  canReview: boolean;
  taskRows: TaskRowSummary[];
  hasMore: boolean;
  nextCursor: string | null;
  selectedTaskId: string | null;
  selectedTask: SelectedTaskDetail | null;
  selectedTaskError: string | null;
  mode?: "work" | "studio";
  members?: MemberSummary[];
  milestones?: { id: string; title: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const consoleRef = useRef<HTMLDivElement>(null);
  const runRailRef = useRef<HTMLDivElement>(null);
  const runRailTriggerRef = useRef<HTMLButtonElement>(null);
  const newTaskTriggerRef = useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = useState<ConsoleLayout>("mobile");
  const [runRailOpen, setRunRailOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // 分栏跟随执行台实际可用宽度，避免受全局侧栏和窗口宽度影响。
  useEffect(() => {
    const element = consoleRef.current;
    if (!element) return;
    const update = (width: number) => {
      setLayout(width >= 1120 ? "desktop" : width >= 760 ? "tablet" : "mobile");
    };
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      update(width);
      if (width >= 1120) setRunRailOpen(false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  // 手机：panel=list 时强制显示列表，否则显示详情。
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

  // 列表与详情能并排时，默认选中当前页第一个未完成任务。
  useEffect(() => {
    if (!selectedTaskId && taskRows.length > 0 && layout !== "mobile" && panel !== "list") {
      const firstPending = taskRows.find((t) => t.status !== "done") ?? taskRows[0];
      router.replace(buildSelectTaskHref(projectId, firstPending.id, currentParams));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, taskRows, projectId, layout, panel]);

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

  const openRunRail = useCallback((trigger: HTMLButtonElement) => {
    runRailTriggerRef.current = trigger;
    setRunRailOpen(true);
  }, []);
  const openNewTask = useCallback((trigger: HTMLButtonElement) => {
    newTaskTriggerRef.current = trigger;
    setNewTaskOpen(true);
  }, []);
  const handleNewTaskOpenChange = useCallback((open: boolean) => setNewTaskOpen(open), []);

  useEffect(() => {
    if (!runRailOpen) {
      if (runRailTriggerRef.current?.isConnected) runRailTriggerRef.current.focus();
      return;
    }
    const dialog = runRailRef.current;
    dialog?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRunRailOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [runRailOpen, layout]);

  useEffect(() => {
    if (!newTaskOpen && newTaskTriggerRef.current?.isConnected) newTaskTriggerRef.current.focus();
  }, [newTaskOpen]);

  return (
    <div ref={consoleRef} className="relative flex min-h-0 w-full flex-col">
      {/* 任务列表与详情工作面 */}
      <div className="flex min-h-0 flex-1 divide-x divide-stroke overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">

        {/* ── 左栏：任务列表 ── */}
        <div
          className={[
            "flex min-w-0 flex-col overflow-y-auto",
            layout !== "mobile" ? "w-[280px] shrink-0" : "w-full",
            layout === "mobile" && selectedTaskId && !showListOnNarrow ? "hidden" : "",
          ].join(" ")}
        >
          <TaskList
            projectId={projectId}
            taskRows={taskRows}
            hasMore={hasMore}
            nextCursor={nextCursor}
            selectedTaskId={selectedTaskId}
            canWrite={canCreateTask}
            mode={mode}
            onSelectTask={selectTask}
            onNewTask={openNewTask}
          />
        </div>

        {/* ── 中栏：交接工作面 ── */}
        <div
          className={[
            "min-w-0 flex-1 overflow-y-auto",
            // 窄屏：有选中任务且不是列表面板时显示
            layout !== "mobile" || (selectedTaskId && !showListOnNarrow) ? "flex flex-col" : "hidden",
          ].join(" ")}
        >
          <TaskContractPanel
            projectId={projectId}
            actorId={actorId}
            canWrite={canWrite}
            canDelete={canDeleteTask}
            canReview={canReview}
            selectedTask={selectedTask}
            selectedTaskError={selectedTaskError}
            selectedTaskId={selectedTaskId}
            members={members}
            layout={layout}
            onBack={clearTask}
            onOpenRunRail={openRunRail}
          />
        </div>

      </div>

      {/* 执行记录按需展开，不常驻占据任务阅读空间 */}
      {runRailOpen && (
        <div aria-hidden={!runRailOpen} className={`fixed inset-0 z-50 justify-end ${runRailOpen ? "flex" : "hidden"}`}>
            <div
              aria-hidden
            className="absolute inset-0 bg-ink/20"
            onClick={() => setRunRailOpen(false)}
          />
          <div ref={runRailRef} role="dialog" aria-modal="true" aria-labelledby="run-rail-dialog-title" tabIndex={-1} className="relative flex h-full w-full max-w-sm flex-col overflow-y-auto bg-panel shadow-xl focus:outline-none">
            <div className="flex items-center justify-between border-b border-stroke px-4 py-3">
              <span id="run-rail-dialog-title" className="text-sm font-medium text-ink">执行记录</span>
              <button
                onClick={() => setRunRailOpen(false)}
                className="ac-pressable rounded p-1 text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                aria-label="关闭执行记录"
              >
                关闭
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AgentRunRail
                projectId={projectId}
                actorId={actorId}
                selectedTask={selectedTask}
                drawerMode
                mode={mode}
              />
            </div>
          </div>
        </div>
      )}
      {canCreateTask && (
        <NewTaskForm
          projectId={projectId}
          members={members}
          milestones={milestones}
          open={newTaskOpen}
          onOpenChange={handleNewTaskOpenChange}
          showTrigger={false}
          dialog
        />
      )}
    </div>
  );
}
