"use client";

/**
 * 交接工作面（W02/W04/W05 中央主面板）。
 *
 * 显示：任务目标、交接要求、完成条件、资料包状态、认领状态、交付证据、当前动作。
 * - 支持内联编辑交接契约（HandoffEditor，W04）
 * - 支持直接认领、拒绝认领、提交成果、验收动作（W05）
 * - 展示真实交付证据列表（EvidenceList，W05）
 * - 不生成虚假交接摘要；字段为空时显示"未填写"。
 * - 不可读上下文显示"无权查看此资料"，不泄露私密内容。
 */

import { useState, useActionState } from "react";
import Link from "next/link";
import {
  claimTaskAction,
  declineTaskAction,
  submitTaskAction,
  reviewTaskAction,
  type FormState,
} from "../actions";
import { isAwaitingResponse, isInFlight, isInReview } from "@/lib/task-status";
import { HandoffEditor } from "./handoff-editor";
import { EvidenceList } from "./evidence-list";
import { TaskConversations } from "./task-conversations";
import type { ConsoleLayout, MemberSummary, SelectedTaskDetail } from "./console-shell";

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
  actorId,
  canWrite,
  canReview,
  selectedTask,
  selectedTaskError,
  selectedTaskId,
  members = [],
  layout,
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
  members?: MemberSummary[];
  layout: ConsoleLayout;
  onBack: () => void;
  onOpenRunRail: (trigger: HTMLButtonElement) => void;
}) {
  const [editingHandoff, setEditingHandoff] = useState(false);

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
  const isMine = Boolean(actorId && task.assigneeId === actorId);
  const versionMatch =
    task.committedHandoffVersion !== null &&
    task.handoffVersion !== null &&
    task.committedHandoffVersion === task.handoffVersion;

  // 动作权限计算
  const canClaim = canWrite && isInFlight(task.status) && (!task.assigneeId || (isMine && (!task.committedAt || !versionMatch)));
  const awaiting = isAwaitingResponse(
    task.status,
    task.assigneeId,
    task.committedAt ? new Date(task.committedAt) : null,
    task.committedHandoffVersion,
    task.handoffVersion,
  );
  const canDecline = isMine && awaiting;
  const canSubmit = isMine && isInFlight(task.status) && Boolean(task.committedAt) && versionMatch;
  const canReviewThis = canReview && isInReview(task.status) && !isMine;

  return (
    <div className="flex flex-col gap-0">
      {/* 头部：真实标题，无广告性副标题 */}
      <div className="flex items-start gap-3 border-b border-stroke px-4 py-3">
        {/* 返回按钮（窄屏） */}
        <button
          onClick={onBack}
          className={`shrink-0 text-xs text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${layout === "mobile" ? "" : "hidden"}`}
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
            {task.assigneeName && <span>负责人：{task.assigneeName}</span>}
            {task.dueDate && <span>截止：{task.dueDate}</span>}
            {task.responseDueAt && (
              <span className="text-caution">
                交接截止：{new Date(task.responseDueAt).toLocaleDateString("zh-CN")}
              </span>
            )}
          </div>
        </div>
        {/* 编辑交接契约入口 */}
        {canWrite && (
          <button
            onClick={() => setEditingHandoff(!editingHandoff)}
            className="shrink-0 rounded border border-stroke px-2.5 py-1 text-xs text-ink-2 hover:bg-panel-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {editingHandoff ? "取消编辑" : "编辑交接信息"}
          </button>
        )}
        {/* 执行记录按钮（<1120px） */}
        <button
          onClick={(event) => onOpenRunRail(event.currentTarget)}
          className={`shrink-0 rounded border border-stroke px-2 py-1 text-xs text-ink-2 hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${layout === "desktop" ? "hidden" : ""}`}
        >
          执行记录
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* 内联交接契约编辑器（W04） */}
        {editingHandoff && (
          <HandoffEditor
            projectId={projectId}
            selectedTask={task}
            canWrite={canWrite}
            members={members}
            availablePacks={task.availablePacks}
            onClose={() => setEditingHandoff(false)}
          />
        )}

        {/* 任务目标 */}
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
                  资料包内容可能已过期。建议重新冻结。
                </div>
              )}
            </div>
          ) : (
            <Empty text="尚未绑定交接资料" />
          )}
        </Section>

        {/* 认领与接手状态 */}
        <Section label="认领状态">
          {task.committedAt ? (
            <div className="text-sm text-ink">
              已认领
              <span className="ml-1 text-xs text-ink-3">
                （{task.committedHandoffVersion === null ? (
                  <><span>认领时版本未记录</span><span className="text-caution">，请重新确认交接契约</span></>
                ) : (
                  <>
                    契约版本 v{task.committedHandoffVersion}
                    {!versionMatch && <span className="text-caution">，交接契约已更新至 v{task.handoffVersion}，需重新确认</span>}
                  </>
                )}）
              </span>
            </div>
          ) : (
            <div className="text-sm text-ink-3">
              未认领
              <span className="ml-1 text-xs">（当前契约版本 v{task.handoffVersion}）</span>
            </div>
          )}
        </Section>

        {/* ── 任务动作面板（W05: 认领、拒绝、交付、验收） ── */}
        {canClaim && (
          <ActionFormBlock
            title={task.committedAt ? "重新确认交接承诺" : "认领任务"}
            action={claimTaskAction}
            projectId={projectId}
            taskId={task.id}
            submitLabel={task.committedAt ? "确认新契约并继续" : "确认认领"}
          >
            <textarea
              name="commitmentNote"
              required
              rows={2}
              aria-label="执行计划"
              placeholder="写一句你的执行承诺或计划（必填）"
              className="ac-field text-sm"
            />
            <input
              type="number"
              name="estimatedHours"
              step="0.5"
              min="0.5"
              max="999"
              placeholder="预估工时（小时，可选）"
              className="ac-field text-xs"
            />
          </ActionFormBlock>
        )}

        {canDecline && (
          <ActionFormBlock
            title="接不住 / 拒绝认领"
            action={declineTaskAction}
            projectId={projectId}
            taskId={task.id}
            submitLabel="退回并说明原因"
          >
            <textarea
              name="reason"
              required
              rows={2}
              aria-label="退回原因"
              placeholder="说明为什么接不住或需要协调什么（必填）"
              className="ac-field text-sm"
            />
          </ActionFormBlock>
        )}

        {canSubmit && (
          <ActionFormBlock
            title="提交成果"
            action={submitTaskAction}
            projectId={projectId}
            taskId={task.id}
            submitLabel="提交待验收"
          >
            <textarea
              name="completionNote"
              required
              rows={2}
              aria-label="交付说明"
              placeholder="说明交付了什么成果、产出物位置或测试说明（必填）"
              className="ac-field text-sm"
            />
          </ActionFormBlock>
        )}

        {canReviewThis && (
          <ActionFormBlock
            title="验收任务"
            action={reviewTaskAction}
            projectId={projectId}
            taskId={task.id}
            submitLabel="提交验收结果"
          >
            <div className="space-y-2">
              <fieldset className="flex gap-4 text-sm text-ink">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="decision" value="accept" defaultChecked /> 通过验收
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="decision" value="reject" /> 退回修改
                </label>
              </fieldset>
              <textarea
                name="note"
                rows={2}
                aria-label="验收意见"
                placeholder="验收意见（退回时必填，通过时可选）"
                className="ac-field text-sm"
              />
            </div>
          </ActionFormBlock>
        )}

        {/* 交付证据（W05） */}
        <Section label="交付证据">
          <EvidenceList evidence={task.evidence} projectId={projectId} />
        </Section>

        {/* 待确认审批 */}
        {task.approvals.filter((a) => a.status === "pending").length > 0 && (
          <Section label="待确认审批">
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

        {/* 会话与分支入口（W06） */}
        <Section label="会话与分支">
          <TaskConversations
            projectId={projectId}
            taskId={task.id}
            conversations={task.conversations ?? []}
          />
        </Section>

        {/* 本地检查点与接续说明（W07） */}
        <details className="group rounded border border-stroke bg-sunken/30 text-xs">
          <summary className="cursor-pointer px-3 py-2 font-medium text-ink-2 hover:text-ink select-none flex items-center justify-between">
            <span>本地检查点与接续说明（VS Code 插件）</span>
            <span className="text-ink-3 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="border-t border-stroke px-3 py-2.5 space-y-2 text-ink-2 leading-relaxed">
            <p>
              <strong className="text-ink">当前边界：</strong>
              网页未接入跨环境共享读取接口（E09 待签收），网页无法枚举队友本地运行的会话或断点。
            </p>
            <p>
              <strong className="text-ink">接续材料流转说明：</strong>
              在 VS Code 插件中保存本地 Checkpoint → 选择材料导出 JSON → 队友导入 → 检查代码基线与交接契约 → 以新会话带入材料继续，或建立并行 worktree。
            </p>
            <p className="text-ink-3">
              提示：原生恢复同一 Session（Native resume）目前不支持；会话分叉与材料继承不代表代码工作区或 Agent 进程已恢复。
            </p>
          </div>
        </details>

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

function ActionFormBlock({
  title,
  action,
  projectId,
  taskId,
  submitLabel,
  children,
}: {
  title: string;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  projectId: string;
  taskId: string;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  return (
    <div className="rounded border border-stroke-strong bg-sunken/40 p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink">{title}</h4>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="taskId" value={taskId} />
        {children}
        {state && "error" in state && (
          <p aria-live="polite" className="text-xs text-risk">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ac-btn min-h-8 px-3 text-xs"
        >
          {pending ? "处理中…" : submitLabel}
        </button>
      </form>
    </div>
  );
}
