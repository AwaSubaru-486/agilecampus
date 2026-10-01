"use client";

/**
 * 任务列表（W02）。
 *
 * 显示当前页任务，按优先分组：待我验收 → 有阻塞 → 我的进行中 → 其他进行中 → 待办 → 已完成（折叠）。
 * 已完成组默认收起，选中其中的任务时自动展开。
 * 只对当前页排序，注明"当前页"不冒充全项目排序。
 */

import Link from "next/link";
import { useState } from "react";
import type { TaskRowSummary } from "./console-shell";
import type { TaskPriorityGroup } from "@/lib/collaboration-console-view";

const GROUP_LABEL: Record<TaskPriorityGroup, string> = {
  awaiting_review: "待我验收",
  blocked: "有阻塞",
  my_active: "我的进行中",
  active: "进行中",
  todo: "待办",
  done: "已完成",
};

const STATUS_CLASSES: Record<string, string> = {
  todo: "bg-ink-3",
  doing: "bg-signal",
  review: "bg-caution",
  done: "bg-success",
};

export function TaskList({
  projectId,
  taskRows,
  hasMore,
  selectedTaskId,
  canWrite,
  mode = "work",
  onSelectTask,
}: {
  projectId: string;
  taskRows: TaskRowSummary[];
  hasMore: boolean;
  nextCursor?: string | null;
  selectedTaskId: string | null;
  canWrite: boolean;
  mode?: "work" | "studio";
  onSelectTask: (id: string) => void;
}) {
  const isStudio = mode === "studio";
  const displayRows = isStudio
    ? taskRows.filter(
        (r) =>
          r.agentRunStatusLabel !== "暂无执行记录" ||
          r.activeRun !== null ||
          r.openBlockerCount > 0,
      )
    : taskRows;

  const [doneExpanded, setDoneExpanded] = useState(
    displayRows.some((t) => t.id === selectedTaskId && t.priorityGroup === "done"),
  );

  // 分组
  const groups: Partial<Record<TaskPriorityGroup, TaskRowSummary[]>> = {};
  const ORDER: TaskPriorityGroup[] = ["awaiting_review", "blocked", "my_active", "active", "todo", "done"];
  for (const row of displayRows) {
    const g = row.priorityGroup;
    if (!groups[g]) groups[g] = [];
    groups[g]!.push(row);
  }

  return (
    <div className="flex flex-col">
      {/* 列表头 */}
      <div className="flex items-center justify-between border-b border-stroke px-3 py-2">
        <span className="text-xs font-medium text-ink-2">
          {isStudio ? "Agent 任务与运行" : "任务"}
          <span className="ml-1 tabular-nums text-ink-3">
            （当前页 {displayRows.length} 项）
          </span>
        </span>
        {isStudio ? (
          <Link
            href={`/projects/${projectId}?space=work`}
            className="rounded px-2 py-0.5 text-xs text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            全部任务 →
          </Link>
        ) : (
          canWrite && (
            <Link
              href={`/projects/${projectId}?space=work`}
              className="rounded px-2 py-0.5 text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              + 新建
            </Link>
          )
        )}
      </div>

      {displayRows.length === 0 && (
        <div className="px-3 py-8 text-center text-sm text-ink-3">
          {isStudio ? (
            <div className="space-y-2">
              <p>暂无执行记录</p>
              <Link
                href={`/projects/${projectId}?space=work`}
                className="inline-block text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                ← 返回任务列表
              </Link>
            </div>
          ) : (
            "暂无任务"
          )}
        </div>
      )}

      {/* 分组渲染 */}
      {ORDER.map((group) => {
        const rows = groups[group];
        if (!rows?.length) return null;

        const isDone = group === "done";
        const expanded = isDone ? doneExpanded : true;

        return (
          <div key={group}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 border-b border-stroke px-3 py-1.5 text-left text-xs font-medium text-ink-2 hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
              onClick={isDone ? () => setDoneExpanded((v) => !v) : undefined}
              aria-expanded={isDone ? expanded : undefined}
            >
              {isDone && (
                <span className="text-ink-3">{expanded ? "▾" : "▸"}</span>
              )}
              {GROUP_LABEL[group]}
              <span className="ml-auto text-ink-3">{rows.length}</span>
            </button>

            {expanded &&
              rows.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  onSelect={() => onSelectTask(task.id)}
                />
              ))}
          </div>
        );
      })}

      {/* 分页提示 */}
      {hasMore && (
        <div className="border-t border-stroke px-3 py-2 text-xs text-ink-3">
          已加载 {taskRows.length} 项，仍有更多——请使用筛选缩小范围
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  selected,
  onSelect,
}: {
  task: TaskRowSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "flex w-full min-h-11 flex-col items-start gap-0.5 border-b border-stroke px-3 py-2 text-left transition-colors",
        "hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal",
        selected ? "bg-panel-active" : "",
      ].join(" ")}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex w-full items-start gap-2">
        {/* 状态点 */}
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_CLASSES[task.status] ?? "bg-ink-3"}`}
          aria-label={task.taskStatusLabel}
        />
        <span className="flex-1 text-sm leading-snug text-ink line-clamp-2">{task.title}</span>
      </div>
      <div className="ml-4 flex items-center gap-2 text-xs text-ink-3">
        {task.assigneeName && (
          <span className="truncate max-w-[7rem]">{task.assigneeName}</span>
        )}
        {task.agentRunStatusLabel !== "暂无执行记录" && (
          <span className="shrink-0 rounded bg-panel px-1 py-0.5 font-mono text-[10px] text-ink-2">
            {task.agentRunStatusLabel}
          </span>
        )}
        {task.openBlockerCount > 0 && (
          <span className="shrink-0 rounded bg-risk/10 px-1 py-0.5 text-[10px] text-risk">
            {task.openBlockerCount} 阻塞
          </span>
        )}
      </div>
    </button>
  );
}
