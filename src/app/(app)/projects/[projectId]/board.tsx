"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  defaultKeyboardCoordinateGetter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { deriveColumns, type BoardColumn, type ColumnPatch } from "@/lib/board-columns";
import type { GroupBy } from "@/lib/board-filters";
import type { TaskStatus } from "@/lib/task-status";
import type { AgentStatus } from "@/db/schema";
import type { EvidenceType } from "@/lib/handoff";
import { moveTaskAction } from "./actions";
import { TaskCard, type Option } from "./task-card";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: TaskStatus;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
  // 承诺与验收：卡片要靠这几项决定显示哪枚按钮、以及把承诺与退回意见摆出来
  commitmentNote: string | null;
  estimatedHours: number | null;
  reviewNote: string | null;
  /** 承诺时刻。非空＝本人已接住；空而有人负责＝还在等他回话 */
  committedAt: Date | null;
  handoffVersion: number;
  committedHandoffVersion: number | null;
  requiredEvidence: EvidenceType[] | null;
  evidenceTypes: string[];
  /** 上一次「接不住」的理由，退回后挂在任务上供派活的人参考 */
  declineReason: string | null;
  // 人机混排：负责人若是 agent，卡片要显示它此刻在干什么
  agentStatus: AgentStatus | null;
  /** 这个任务上正有 agent 在跑 */
  hasActiveRun: boolean;
};

type ViewMode = "board" | "list";
export type CardDensity = "comfortable" | "compact";

function Column({
  column,
  tasks,
  projectId,
  canWrite,
  canReview,
  currentUserId,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
  viewMode,
  density,
  dragEnabled,
  listMode,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  projectId: string;
  canWrite: boolean;
  canReview: boolean;
  currentUserId: string;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
  viewMode: ViewMode;
  density: CardDensity;
  dragEnabled: boolean;
  listMode: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !dragEnabled });

  return (
    <div
      ref={setNodeRef}
      className={`${viewMode === "list" ? "w-full border-x-0 border-b-0 p-0" : "w-[19rem] shrink-0 min-h-48 space-y-2.5 border border-t-2 p-3"} transition-[background-color,border-color] duration-200 ${
        isOver
          ? "border-stroke-strong bg-sunken"
          : "border-line bg-sunken/20"
      }`}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <h3 className={`text-xs font-semibold ${column.tone}`}>
          {column.label}
        </h3>
        <span className="min-w-5 border border-line bg-surface px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums text-ink-soft">{tasks.length}</span>
      </div>
      <div className={viewMode === "list" ? "divide-y divide-line border-y border-line" : "space-y-2.5"}>
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            projectId={projectId}
            canWrite={canWrite}
            canReview={canReview}
            currentUserId={currentUserId}
            members={members}
            milestones={milestones}
            allTasks={allTasks}
            allLabels={allLabels}
            dependencies={dependencies}
            density={density}
            dragEnabled={dragEnabled}
            listMode={listMode}
          />
        ))}
        {tasks.length === 0 && (
          <div className="border-y border-line bg-surface/40 px-3 py-8 text-center">
            <p className="text-xs text-ink-faint">这里还没有任务</p>
          </div>
        )}
      </div>
      {canWrite && column.patch.status && (
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("agilecampus:new-task", {
              detail: { status: column.patch.status },
            }));
            document.getElementById("quick-task")?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className="w-full border-t border-line px-2 py-2 text-left text-xs text-ink-faint transition hover:bg-surface hover:text-primary"
        >
          ＋ 在“{column.label}”添加任务
        </button>
      )}
    </div>
  );
}

export function Board({
  projectId,
  tasks,
  groupBy,
  canWrite,
  canReview,
  currentUserId,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  projectId: string;
  tasks: BoardTask[];
  groupBy: GroupBy;
  canWrite: boolean;
  /** 组长或教师。与 canWrite 并列：教师能验收，但仍不能编辑与拖拽 */
  canReview: boolean;
  currentUserId: string;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 列表是项目管理的默认工作面：先让人找到要做的事，再切换到看板做空间规划。
  // 这也是 Linear、Plane 等成熟工具常见的入口顺序，移动端不会被横向看板截断。
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [density, setDensity] = useState<CardDensity>("compact");
  const [optimisticTasks, moveOptimistic] = useOptimistic(
    tasks,
    (current, move: { taskId: string; patch: ColumnPatch }) =>
      current.map((t) => (t.id === move.taskId ? { ...t, ...move.patch } : t)),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: defaultKeyboardCoordinateGetter }),
  );

  const columns = deriveColumns(groupBy, { members, milestones });

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (event.key === "1") setViewMode("board");
      if (event.key === "2") setViewMode("list");
      if (event.key.toLowerCase() === "f") setDensity("comfortable");
      if (event.key.toLowerCase() === "m") setDensity("compact");
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const taskId = String(event.active.id);
    const over = event.over?.id;
    if (!over) return;
    const column = columns.find((c) => c.key === String(over));
    const task = optimisticTasks.find((t) => t.id === taskId);
    // 已在目标列则无须提交
    if (!column || !task || column.matches(task)) return;

    startTransition(async () => {
      setError(null);
      moveOptimistic({ taskId, patch: column.patch });
      const res = await moveTaskAction({ taskId, projectId, patch: column.patch });
      if (res?.error) setError(res.error);
    });
  }

  const activeTask = activeId
    ? optimisticTasks.find((task) => task.id === activeId) ?? null
    : null;

  return (
    <DndContext
      id={`board-${projectId}`}
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      {error && <p role="status" aria-live="polite" className="text-sm text-high">{error}</p>}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-y border-line px-1.5 py-1">
        <div className="flex items-center gap-1" aria-label="任务视图">
          <ModeButton active={viewMode === "board"} onClick={() => setViewMode("board")} hint="1">看板</ModeButton>
          <ModeButton active={viewMode === "list"} onClick={() => setViewMode("list")} hint="2">列表</ModeButton>
        </div>
        <span className="text-[10px] text-ink-faint">快捷键：1 看板，2 列表</span>
      </div>
      {/* 列数随分组维度而变，故横向滚动而非固定三栏 */}
      <div className={`${viewMode === "list" ? "flex-col" : "overflow-x-auto"} flex gap-3 pb-3 [scrollbar-width:thin]`}>
        {columns.map((col) => (
          <Column
            key={col.key}
            column={col}
            tasks={optimisticTasks.filter((t) => col.matches(t))}
            projectId={projectId}
            canWrite={canWrite}
            canReview={canReview}
            currentUserId={currentUserId}
            members={members}
            milestones={milestones}
            allTasks={allTasks}
            allLabels={allLabels}
            dependencies={dependencies}
            viewMode={viewMode}
            density={density}
            dragEnabled={groupBy !== "status"}
            listMode={viewMode === "list"}
          />
        ))}
      </div>
      <DragOverlay
        dropAnimation={{
          duration: 220,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        {activeTask && (
          <div className="w-[19rem] -translate-y-0.5 border border-stroke-strong bg-surface p-4 text-sm shadow-[0_18px_40px_-18px_rgba(0,0,0,0.45)]">
            <p className="font-medium text-ink">{activeTask.title}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-soft">
              <span>{activeTask.assigneeName ?? "未分配"}</span>
              <span className="ac-badge bg-sunken text-ink-2">移动中</span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function ModeButton({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`ac-pressable min-h-9 border-b-2 px-2.5 py-1.5 text-xs font-medium ${active ? "border-ink text-ink" : "border-transparent text-ink-soft hover:border-line-strong hover:bg-sunken"}`}
    >
      {children}<span className={`ml-1 text-[9px] ${active ? "text-white/45" : "text-ink-faint"}`}>{hint}</span>
    </button>
  );
}
