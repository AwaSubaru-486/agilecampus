"use client";

/**
 * 执行记录侧轨（W03）。
 *
 * 显示选中任务的真实 Run 列表、选中运行摘要、审批项和任务活动。
 * Run 正文仅在明确选择某次运行后由服务端按 project/task/run 校验读取。
 *
 * 没有 Run：显示"暂无执行记录"。
 * 不伪造 running 状态。不显示"启动 Agent""恢复执行"等歧义按钮。
 */

import Link from "next/link";
import { useState } from "react";
import { agentRunStatusLabel } from "@/lib/collaboration-console-view";
import { buildSelectRunHref } from "@/lib/console-navigation";
import type { SelectedTaskDetail } from "./console-shell";
import { loadConsoleEventsPage, loadConsoleRunsPage } from "./actions";

function mergeHistory<T extends { id: string }>(latest: T[], loaded: T[]) {
  const latestIds = new Set(latest.map((item) => item.id));
  return [...latest, ...loaded.filter((item) => !latestIds.has(item.id))];
}

type LoadedPage<T> = {
  taskId: string;
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
};

function isContinuous<T extends { id: string }>(latest: T[], loaded: LoadedPage<T> | null | undefined) {
  if (!loaded) return false;
  const loadedIds = new Set(loaded.items.map((item) => item.id));
  return latest.some((item) => loadedIds.has(item.id));
}

export function AgentRunRail({
  projectId,
  selectedTask,
  drawerMode,
  mode,
}: {
  projectId: string;
  actorId?: string;
  selectedTask: SelectedTaskDetail | null;
  drawerMode: boolean;
  mode: "work" | "studio";
}) {
  const [loadedRuns, setLoadedRuns] = useState<LoadedPage<SelectedTaskDetail["runs"][number]> | null>(null);
  const [loadedEvents, setLoadedEvents] = useState<LoadedPage<SelectedTaskDetail["events"][number]> | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<"runs" | "events" | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  if (!selectedTask) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-3">
        选择任务后查看执行记录
      </div>
    );
  }

  const task = selectedTask;
  const runPage = loadedRuns?.taskId === task.id && isContinuous(task.runs, loadedRuns) ? loadedRuns : null;
  const eventPage = loadedEvents?.taskId === task.id && isContinuous(task.events, loadedEvents) ? loadedEvents : null;
  const runs = runPage ? mergeHistory(task.runs, runPage.items) : task.runs;
  const hasMoreRuns = runPage?.hasMore ?? task.hasMoreRuns;
  const events = eventPage ? mergeHistory(task.events, eventPage.items) : task.events;
  const hasMoreEvents = eventPage?.hasMore ?? task.hasMoreEvents;
  const runCursor = runPage?.nextCursor ?? task.runsNextCursor;
  const eventCursor = eventPage?.nextCursor ?? task.eventsNextCursor;
  const { approvals, capabilities, selectedRun, selectedRunError } = task;
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  async function loadMore(kind: "runs" | "events") {
    const cursor = kind === "runs" ? runCursor : eventCursor;
    if (!cursor || loadingHistory) return;
    setLoadingHistory(kind);
    setHistoryError(null);
    try {
      if (kind === "runs") {
        const result = await loadConsoleRunsPage(projectId, task.id, cursor);
        if (!result.ok) {
          setHistoryError(result.error);
          return;
        }
        setLoadedRuns((previous) => {
          const current = previous?.taskId === task.id && isContinuous(task.runs, previous) ? previous : null;
          if (!current && task.runs.length === 0) return null;
          const base = current ?? {
            taskId: task.id,
            items: task.runs,
            hasMore: task.hasMoreRuns,
            nextCursor: task.runsNextCursor,
          };
          const existing = new Set(base.items.map((run) => run.id));
          return {
            ...base,
            items: [...base.items, ...result.items.filter((run) => !existing.has(run.id))],
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
          };
        });
      } else {
        const result = await loadConsoleEventsPage(projectId, task.id, cursor);
        if (!result.ok) {
          setHistoryError(result.error);
          return;
        }
        setLoadedEvents((previous) => {
          const current = previous?.taskId === task.id && isContinuous(task.events, previous) ? previous : null;
          if (!current && task.events.length === 0) return null;
          const base = current ?? {
            taskId: task.id,
            items: task.events,
            hasMore: task.hasMoreEvents,
            nextCursor: task.eventsNextCursor,
          };
          const existing = new Set(base.items.map((event) => event.id));
          return {
            ...base,
            items: [...base.items, ...result.items.filter((event) => !existing.has(event.id))],
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
          };
        });
      }
    } catch {
      setHistoryError("加载记录失败，请重试");
    } finally {
      setLoadingHistory(null);
    }
  }

  return (
    <div className={`flex flex-col gap-0 ${drawerMode ? "" : ""}`}>
      {/* Run 列表与所选运行摘要 */}
      <div className="border-b border-stroke px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2">Agent 运行</h3>
          <span className="text-xs tabular-nums text-ink-3">{runs.length}{hasMoreRuns ? "+" : ""}</span>
        </div>
        <div className="mt-2 space-y-1">
          {runs.length === 0 ? (
            <p className="text-sm text-ink-3">暂无执行记录</p>
          ) : (
            runs.map((run) => (
              <Link
                key={run.id}
                href={buildSelectRunHref(projectId, selectedTask.id, mode, run.id)}
                aria-current={selectedRun?.id === run.id ? "true" : undefined}
                className={`flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${selectedRun?.id === run.id ? "bg-panel-hover" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{agentRunStatusLabel(run.status)}</span>
                  <span className="block truncate text-xs text-ink-3">{run.agentName ?? `Agent ${run.agentId.slice(0, 8)}`}</span>
                </span>
                <time className="shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-ink-3" dateTime={run.createdAt}>
                  {new Date(run.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </time>
              </Link>
            ))
          )}
        </div>
        {hasMoreRuns && (
          <button type="button" disabled={loadingHistory !== null} onClick={() => void loadMore("runs")} className="mt-2 min-h-9 w-full border border-stroke px-2 text-xs text-ink-2 hover:bg-panel-hover disabled:opacity-50">
            {loadingHistory === "runs" ? "加载中…" : "加载更早的运行记录"}
          </button>
        )}

        {selectedRunError ? (
          <p className="mt-3 text-sm text-risk" role="alert">{selectedRunError}</p>
        ) : selectedRun ? (
          <div className="mt-3 border-t border-stroke pt-3">
            <h4 className="text-xs font-medium text-ink-2">运行详情</h4>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-ink-3">状态</dt><dd className="text-ink">{agentRunStatusLabel(selectedRun.status)}</dd>
              <dt className="text-ink-3">Agent</dt><dd className="truncate text-ink">{selectedRun.agentName ?? selectedRun.agentId}</dd>
              <dt className="text-ink-3">开始</dt><dd className="text-ink">{selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleString("zh-CN") : "未记录"}</dd>
              <dt className="text-ink-3">结束</dt><dd className="text-ink">{selectedRun.finishedAt ? new Date(selectedRun.finishedAt).toLocaleString("zh-CN") : "仍在执行或未记录"}</dd>
            </dl>
            {selectedRun.error && (
              <div className="mt-2">
                <h5 className="text-xs font-medium text-risk">错误信息</h5>
                <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">{selectedRun.error}</pre>
              </div>
            )}
            {selectedRun.resultPreview && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">查看运行结果</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-sunken p-2 font-mono text-[11px] text-ink-2">{selectedRun.resultPreview}</pre>
              </details>
            )}
          </div>
        ) : runs.length > 0 ? (
          <p className="mt-3 border-t border-stroke pt-3 text-xs text-ink-3">选择一条运行记录查看详情。</p>
        ) : null}
      </div>

      {/* 能力边界说明 */}
      {!capabilities.canStartAgentRun && !capabilities.canResumeAgentRun && (
        <div className="border-b border-stroke px-4 py-3">
          <p className="text-xs text-ink-3">
            网页暂无 Agent 启动/恢复接口。如需执行，请在 VS Code 插件中操作。
          </p>
        </div>
      )}

      {/* 待确认审批 */}
      {pendingApprovals.length > 0 && (
        <div className="border-b border-stroke px-4 py-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2 mb-2">
            待人工确认
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((a) => (
              <div
                key={a.id}
                className="rounded border border-stroke p-2.5 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-ink">{a.title}</span>
                  {a.canResolve ? (
                    <Link
                      href={`/projects/${projectId}?space=studio&approval=${a.id}&task=${selectedTask.id}`}
                      className="shrink-0 text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    >
                      处理
                    </Link>
                  ) : (
                    <span className="shrink-0 text-xs text-ink-3">等待有权人</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 任务活动摘要 */}
      <div className="px-4 py-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2">任务活动</h3>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">暂无记录</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {events.map((event) => (
              <li key={event.id} className="border-b border-stroke pb-2 last:border-0">
                <p className="text-xs leading-5 text-ink">{event.summary ?? "任务活动"}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                  <span>{event.actorName ?? (event.actorId ? "成员已移除" : "系统")}</span>
                  <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                </p>
              </li>
            ))}
          </ol>
        )}
        {hasMoreEvents && (
          <button type="button" disabled={loadingHistory !== null} onClick={() => void loadMore("events")} className="mt-2 min-h-9 w-full border border-stroke px-2 text-xs text-ink-2 hover:bg-panel-hover disabled:opacity-50">
            {loadingHistory === "events" ? "加载中…" : "加载更早的活动"}
          </button>
        )}
        {historyError && <p className="mt-2 text-xs text-risk" role="alert">{historyError}</p>}
      </div>
    </div>
  );
}
