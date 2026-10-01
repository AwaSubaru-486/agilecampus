"use client";

/**
 * 交接工作面（W02 中央面板）。
 *
 * 显示：任务目标、交接要求、完成条件、资料包状态、待确认审批、当前阻塞。
 * 不生成虚假交接摘要；字段为空时显示"未填写"。
 * 不可读上下文显示"无权查看此资料"，不泄露私密内容。
 */

import Link from "next/link";
import type { SelectedTaskDetail } from "./console-shell";

const STATUS_LABEL: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  review: "待验收",
  done: "已完成",
};

const STATUS_CLASSES: Record<string, string> = {
  todo: "bg-ink-3/20 text-ink-2",
  doing: "bg-signal/10 text-signal",
  review: "bg-caution/10 text-caution",
  done: "bg-success/10 text-success",
};

export function TaskContractPanel({
  projectId,
  canWrite,
  canReview,
  selectedTask,
  selectedTaskError,
  selectedTaskId,
  onBack,
  onOpenRunRail,
}: {
  projectId: string;
  actorId?: string;
  canWrite: boolean;
  canReview: boolean;
  selectedTask: SelectedTaskDetail | null;
  selectedTaskError: string | null;
  selectedTaskId: string | null;
  onBack: () => void;
  onOpenRunRail: () => void;
}) {
  // 未选中任务
  if (!selectedTaskId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-3">
        从左侧选择一个任务查看详情
      </div>
    );
  }

  // 权限/不存在错误
  if (selectedTaskError) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <button
          onClick={onBack}
          className="self-start text-xs text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          ← 返回任务列表
        </button>
        <p className="text-sm text-risk">{selectedTaskError}</p>
      </div>
    );
  }

  if (!selectedTask) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-3">
        加载中…
      </div>
    );
  }

  const task = selectedTask;
  const versionMatch =
    task.committedHandoffVersion !== null &&
    task.handoffVersion !== null &&
    task.committedHandoffVersion === task.handoffVersion;

  return (
    <div className="flex flex-col gap-0">
      {/* 头部 */}
      <div className="flex items-start gap-3 border-b border-stroke px-4 py-3">
        {/* 返回按钮（窄屏） */}
        <button
          onClick={onBack}
          className="shrink-0 text-xs text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal xl:hidden"
          aria-label="返回任务列表"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug text-ink">{task.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${STATUS_CLASSES[task.status] ?? "bg-panel text-ink-2"}`}
            >
              {STATUS_LABEL[task.status] ?? task.status}
            </span>
            {task.assigneeName && <span>{task.assigneeName}</span>}
            {task.dueDate && <span>截止：{task.dueDate}</span>}
            {task.responseDueAt && (
              <span className="text-caution">
                交接截止：{new Date(task.responseDueAt).toLocaleDateString("zh-CN")}
              </span>
            )}
          </div>
        </div>
        {/* 编辑入口（仅 canWrite） */}
        {canWrite && (
          <Link
            href={`/projects/${projectId}?space=work&task=${task.id}&edit=1`}
            className="shrink-0 rounded px-2 py-1 text-xs text-ink-2 hover:text-ink hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            编辑
          </Link>
        )}
        {/* 执行记录按钮（<1120px） */}
        <button
          onClick={onOpenRunRail}
          className="shrink-0 rounded px-2 py-1 text-xs text-ink-2 hover:text-ink hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal min-[1120px]:hidden"
        >
          执行记录
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* 任务描述 */}
        <Section label="任务目标">
          {task.description ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{task.description}</p>
          ) : (
            <Empty />
          )}
        </Section>

        {/* 交接要求 */}
        <Section label="交接要求">
          {task.handoffBrief ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{task.handoffBrief}</p>
          ) : (
            <Empty />
          )}
        </Section>

        {/* 完成条件 */}
        {task.doneCriteria && task.doneCriteria.length > 0 && (
          <Section label="完成条件">
            <ul className="space-y-1">
              {task.doneCriteria.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
                  {c}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 交件要求 */}
        {task.requiredEvidence && (
          <Section label="交件要求">
            <p className="whitespace-pre-wrap text-sm text-ink">{task.requiredEvidence}</p>
          </Section>
        )}

        {/* 交接资料（冻结上下文包） */}
        <Section label="交接资料">
          {task.contextUnavailable ? (
            <p className="text-sm text-ink-3">无权查看此资料</p>
          ) : task.contextPackId ? (
            <div className="rounded border border-stroke p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {task.contextTitle ?? "未命名资料包"}
                </span>
                <span
                  className={`text-xs ${task.contextFrozen ? "text-success" : "text-caution"}`}
                >
                  {task.contextFrozen ? "已冻结" : "未冻结"}
                </span>
              </div>
              {task.contextFrozenAt && (
                <div className="mt-1 text-xs text-ink-3">
                  冻结于 {new Date(task.contextFrozenAt).toLocaleString("zh-CN")}
                </div>
              )}
              {task.contextStale && (
                <div className="mt-1.5 rounded bg-caution/10 px-2 py-1 text-xs text-caution">
                  ⚠ 资料包内容可能已过期，建议重新冻结
                </div>
              )}
            </div>
          ) : (
            <Empty text="尚未绑定交接资料" />
          )}
        </Section>

        {/* 认领状态 */}
        <Section label="认领状态">
          {task.committedAt ? (
            <div className="text-sm text-ink">
              已认领
              <span className="ml-1 text-xs text-ink-3">
                （契约版本 {task.committedHandoffVersion}
                {versionMatch ? "" : <span className="text-caution">，交接要求已更新，需重新确认</span>}）
              </span>
            </div>
          ) : (
            <p className="text-sm text-ink-3">未认领</p>
          )}
        </Section>

        {/* 待确认审批 */}
        {task.approvals.filter((a) => a.status === "pending").length > 0 && (
          <Section label="待确认">
            <div className="space-y-2">
              {task.approvals
                .filter((a) => a.status === "pending")
                .map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-2 rounded border border-stroke p-2.5 text-sm"
                  >
                    <span className="text-ink">{a.title}</span>
                    {a.canResolve ? (
                      <Link
                        href={`/projects/${projectId}?space=studio&approval=${a.id}&task=${task.id}`}
                        className="shrink-0 text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                      >
                        处理
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs text-ink-3">等待有权人处理</span>
                    )}
                  </div>
                ))}
            </div>
          </Section>
        )}

        {/* 验收入口（canReview + 待验收状态） */}
        {canReview && task.status === "review" && (
          <div className="rounded border border-stroke p-3">
            <p className="text-sm text-ink">此任务待验收</p>
            <div className="mt-2 flex gap-2">
              <Link
                href={`/projects/${projectId}?space=work&task=${task.id}&edit=1`}
                className="rounded border border-stroke bg-panel px-3 py-1.5 text-xs text-ink hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                查看并验收
              </Link>
            </div>
          </div>
        )}

        {/* 任务动作：无启动 Agent 按钮（网页无执行接口） */}
        {!selectedTask.capabilities.canStartAgentRun && (
          <p className="text-xs text-ink-3">
            如需启动 Agent 执行，请在 VS Code 插件中操作
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2">{label}</h3>
      {children}
    </div>
  );
}

function Empty({ text = "未填写" }: { text?: string }) {
  return <p className="text-sm text-ink-3">{text}</p>;
}
