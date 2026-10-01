"use client";

/**
 * 执行记录侧轨（W03）。
 *
 * 显示选中任务的 Run 状态摘要和任务活动。
 * 数据来自服务端传入的 selectedTask（counts + approvals），
 * 详细 Run 列表通过查看网页（W03 后续服务端投影）按需展示。
 *
 * 没有 Run：显示"暂无执行记录"。
 * 不伪造 running 状态。不显示"启动 Agent""恢复执行"等歧义按钮。
 */

import Link from "next/link";
import type { SelectedTaskDetail } from "./console-shell";

export function AgentRunRail({
  projectId,
  selectedTask,
  drawerMode,
}: {
  projectId: string;
  actorId?: string;
  selectedTask: SelectedTaskDetail | null;
  drawerMode: boolean;
}) {
  if (!selectedTask) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-3">
        选择任务后查看执行记录
      </div>
    );
  }

  const { runsCount, hasMoreRuns, eventsCount, approvals, capabilities } = selectedTask;
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  return (
    <div className={`flex flex-col gap-0 ${drawerMode ? "" : ""}`}>
      {/* Run 摘要 */}
      <div className="border-b border-stroke px-4 py-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2">Agent / Run 状态</h3>
        <div className="mt-2 space-y-2">
          {runsCount === 0 ? (
            <p className="text-sm text-ink-3">暂无执行记录</p>
          ) : (
            <div className="text-sm text-ink">
              共 {runsCount} 条记录{hasMoreRuns ? "（仍有更多）" : ""}
              <div className="mt-1">
                <Link
                  href={`/projects/${projectId}?space=studio&task=${selectedTask.id}`}
                  className="text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  查看任务会话 →
                </Link>
              </div>
            </div>
          )}
        </div>
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
        {eventsCount === 0 ? (
          <p className="mt-2 text-sm text-ink-3">暂无记录</p>
        ) : (
          <p className="mt-2 text-sm text-ink">
            {eventsCount} 条活动
            <Link
              href={`/projects/${projectId}?space=studio&task=${selectedTask.id}`}
              className="ml-2 text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              查看会话与分支 →
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
