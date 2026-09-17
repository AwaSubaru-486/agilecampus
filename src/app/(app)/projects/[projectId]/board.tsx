"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { deriveColumns, type BoardColumn, type ColumnPatch } from "@/lib/board-columns";
import type { GroupBy } from "@/lib/board-filters";
import { moveTaskAction } from "./actions";
import { TaskCard, type Option } from "./task-card";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
};

function Column({
  column,
  tasks,
  projectId,
  canWrite,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  projectId: string;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-48 w-[19rem] shrink-0 space-y-2.5 rounded-2xl border p-3 transition-[background-color,border-color,box-shadow,transform] duration-200 ${
        isOver
          ? "scale-[1.01] border-primary bg-primary-soft shadow-[0_0_0_3px_var(--color-primary-ring)]"
          : "border-line bg-[#f1f3f7]"
      }`}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <h3 className={`flex items-center gap-2 text-xs font-semibold ${column.tone}`}>
          <span className="size-1.5 rounded-full bg-current" />
          {column.label}
        </h3>
        <span className="grid min-w-5 place-items-center rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink-soft shadow-sm">{tasks.length}</span>
      </div>
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          projectId={projectId}
          canWrite={canWrite}
          members={members}
          milestones={milestones}
          allTasks={allTasks}
          allLabels={allLabels}
          dependencies={dependencies}
        />
      ))}
      {tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface/40 px-3 py-8 text-center">
          <p className="text-xs text-ink-faint">这里还没有任务</p>
          {canWrite && <a href="#quick-task" className="mt-1 inline-block text-xs text-primary hover:underline">添加一项</a>}
        </div>
      )}
    </div>
  );
}

export function Board({
  projectId,
  tasks,
  groupBy,
  canWrite,
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
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [optimisticTasks, moveOptimistic] = useOptimistic(
    tasks,
    (current, move: { taskId: string; patch: ColumnPatch }) =>
      current.map((t) => (t.id === move.taskId ? { ...t, ...move.patch } : t)),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const columns = deriveColumns(groupBy, { members, milestones });

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
      {error && <p className="text-sm text-high">{error}</p>}
      {/* 列数随分组维度而变，故横向滚动而非固定三栏 */}
      <div className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {columns.map((col) => (
          <Column
            key={col.key}
            column={col}
            tasks={optimisticTasks.filter((t) => col.matches(t))}
            projectId={projectId}
            canWrite={canWrite}
            members={members}
            milestones={milestones}
            allTasks={allTasks}
            allLabels={allLabels}
            dependencies={dependencies}
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
          <div className="w-[19rem] rotate-[1.2deg] scale-[1.02] rounded-2xl border border-primary/30 bg-surface p-4 text-sm shadow-[0_24px_55px_-18px_rgba(21,27,38,0.42)]">
            <p className="font-medium text-ink">{activeTask.title}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-soft">
              <span>{activeTask.assigneeName ?? "未分配"}</span>
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-primary">移动中</span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
