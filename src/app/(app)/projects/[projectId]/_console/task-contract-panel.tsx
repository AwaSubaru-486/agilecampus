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
import { useRouter } from "next/navigation";
import {
  claimTaskAction,
  declineTaskAction,
  submitTaskAction,
  reviewTaskAction,
  deleteTaskAction,
  type FormState,
} from "../actions";
import { isAwaitingResponse, isInFlight, isInReview } from "@/lib/task-status";
import { HandoffEditor } from "./handoff-editor";
import { EvidenceList } from "./evidence-list";
import { TaskConversations } from "./task-conversations";
import type { ConsoleLayout, MemberSummary, SelectedTaskDetail } from "./console-shell";
import type { EvidenceType } from "@/lib/handoff";

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

const EVIDENCE_LABELS: Record<EvidenceType, string> = {
  link: "外部链接",
  file: "交付文件",
  text: "文本说明",
  test: "单测日志",
  demo: "演示证据",
};

const ATTEMPT_STATE_LABELS: Record<string, string> = {
  started: "执行中",
  finished: "已完成",
  failed: "已失败",
  unknown: "未知状态",
};

const ATTEMPT_STATE_CLASSES: Record<string, string> = {
  started: "bg-signal/10 text-signal border-signal/30",
  finished: "bg-success/10 text-success border-success/30",
  failed: "bg-risk/10 text-risk border-risk/30",
  unknown: "bg-ink-3/20 text-ink-2 border-stroke",
};

const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  constraint: "约束限制",
  decision: "架构决策",
  learned: "已验证经验",
  rejected_approach: "废弃方案",
};

const MEMORY_STATUS_LABELS: Record<string, string> = {
  active: "生效中",
  needs_review: "待复核",
  superseded: "已替代",
};

export function TaskContractPanel({
  projectId,
  actorId,
  canWrite,
  canDelete = false,
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
  canDelete?: boolean;
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
        {/* 删除任务（仅组长可用） */}
        {canDelete && (
          <DeleteTaskButton projectId={projectId} taskId={task.id} onDeleted={onBack} />
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
        {task.requiredEvidence && task.requiredEvidence.length > 0 && (
          <Section label="交件要求">
            <p className="whitespace-pre-wrap text-sm text-ink">
              {task.requiredEvidence.map((type) => EVIDENCE_LABELS[type]).join("、")}
            </p>
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
            title={task.committedAt ? "重新确认交接承诺 (接住)" : "认领任务 (接住)"}
            action={claimTaskAction}
            projectId={projectId}
            taskId={task.id}
            submitLabel={task.committedAt ? "确认新契约并继续" : "确认接住 / 认领任务"}
            successMessage="✅ 任务已成功接住并认领！"
          >
            <textarea
              name="commitmentNote"
              required
              rows={2}
              aria-label="执行计划"
              placeholder="写一句你的执行承诺或计划（必填，例如：今天内完成该模块开发）"
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
            successMessage="✅ 已说明原因并退回任务！"
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
            successMessage="✅ 成果物已提交待验收！"
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
            successMessage="✅ 验收结果已提交并生效！"
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

        {/* 并行接续尝试（B04） */}
        <Section label="并行接续尝试">
          {task.attempts && task.attempts.length > 0 ? (
            <div className="space-y-2">
              {task.attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="rounded border border-stroke bg-sunken/30 p-2.5 space-y-1.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-ink">
                        {attempt.actorName || "执行者"}
                      </span>
                      <span className="rounded bg-ink-3/15 px-1.5 py-0.5 text-[10px] text-ink-2">
                        {attempt.kind === "parallel" ? "并行分支" : "主线接续"}
                      </span>
                    </div>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        ATTEMPT_STATE_CLASSES[attempt.state] ?? ATTEMPT_STATE_CLASSES.unknown
                      }`}
                    >
                      {ATTEMPT_STATE_LABELS[attempt.state] ?? attempt.state}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-3 text-[11px] font-mono">
                    {attempt.branchName && (
                      <span>分支: <strong className="text-ink-2">{attempt.branchName}</strong></span>
                    )}
                    <span>基线: {attempt.baseSha.slice(0, 8)}</span>
                    {attempt.receipt.headSha && (
                      <span>产出: {attempt.receipt.headSha.slice(0, 8)}</span>
                    )}
                  </div>

                  {attempt.receipt.tests && attempt.receipt.tests.length > 0 && (
                    <div className="mt-1 space-y-1 rounded bg-panel/60 p-1.5 border border-stroke/50">
                      <div className="text-[10px] font-medium text-ink-3 uppercase">测试验证回执</div>
                      <div className="space-y-0.5 font-mono text-[11px]">
                        {attempt.receipt.tests.map((t, idx) => (
                          <div key={idx} className="flex items-center justify-between text-ink-2">
                            <span className="truncate">{t.commandLabel}</span>
                            <span
                              className={`shrink-0 font-sans font-medium px-1 rounded text-[10px] ${
                                t.exitCode === 0
                                  ? "text-success bg-success/10"
                                  : "text-risk bg-risk/10"
                              }`}
                            >
                              {t.exitCode === 0 ? "通过" : `退出码 ${t.exitCode ?? "异常"}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {attempt.receipt.changedPaths && attempt.receipt.changedPaths.length > 0 && (
                    <div className="text-[11px] text-ink-3">
                      变更文件: {attempt.receipt.changedPaths.length} 个
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-3">
              暂无并行尝试记录。在 VS Code 插件中接收交接后，即可创建主线或并行分支尝试并回传执行回执。
            </p>
          )}
        </Section>

        {/* 有效项目记忆（B05） */}
        <Section label="有效项目记忆">
          {task.memories && task.memories.length > 0 ? (
            <div className="space-y-2">
              {task.memories.map((mem) => (
                <div
                  key={mem.id}
                  className="rounded border border-stroke bg-sunken/30 p-2.5 space-y-1 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-signal/15 px-1.5 py-0.5 text-[10px] font-medium text-signal">
                        {MEMORY_CATEGORY_LABELS[mem.category] ?? mem.category}
                      </span>
                      <strong className="text-ink font-medium">{mem.title}</strong>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        mem.status === "active"
                          ? "bg-success/10 text-success"
                          : mem.status === "needs_review"
                            ? "bg-caution/10 text-caution"
                            : "bg-ink-3/20 text-ink-3 line-through"
                      }`}
                    >
                      {MEMORY_STATUS_LABELS[mem.status] ?? mem.status}
                    </span>
                  </div>
                  <p className="text-ink-2 whitespace-pre-wrap leading-relaxed">{mem.content}</p>
                  <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-ink-3 pt-0.5">
                    {mem.creatorName && <span>记录人: {mem.creatorName}</span>}
                    {mem.codeRefSha && (
                      <span className="font-mono">代码引用: {mem.codeRefSha.slice(0, 8)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-3">
              当前任务暂无关联的有效记忆。可沉淀技术决策、约束限制或废弃方案供团队与后续 Agent 复用。
            </p>
          )}
        </Section>

        {/* 检查点共享与接续契约（W07/B01） */}
        <details className="group rounded border border-stroke bg-sunken/30 text-xs">
          <summary className="cursor-pointer px-3 py-2 font-medium text-ink-2 hover:text-ink select-none flex items-center justify-between">
            <span>检查点共享与接续契约（VS Code 插件）</span>
            <span className="text-ink-3 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="border-t border-stroke px-3 py-2.5 space-y-2 text-ink-2 leading-relaxed">
            <p>
              <strong className="text-ink">共享契约状态：</strong>
              E09 契约已签署，支持通过 VS Code 插件登记小体积检查点索引、发起点对点交接并执行基线预检（Preflight）。
            </p>
            <p>
              <strong className="text-ink">接续流转机制：</strong>
              发起交接 → 接收人运行预检（校验 Git 基线与工作区状态）→ 接收后自动创建 Attempt 执行回执 → 并行尝试结果实时聚合回传。
            </p>
            <p className="text-ink-3">
              提示：Handoff 接收不自动改派任务负责人；多方案并行可由团队比对回执与测试结果后统一验收。
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
  successMessage = "操作成功已生效！",
  children,
}: {
  title: string;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  projectId: string;
  taskId: string;
  submitLabel: string;
  successMessage?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [success, setSuccess] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    setSuccess(null);
    try {
      const res = await action(prev, fd);
      if (!res || !("error" in res)) {
        setSuccess(successMessage);
        router.refresh();
        return null;
      }
      return res;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "请求失败";
      return { error: msg };
    }
  }, null);

  return (
    <div className="rounded border border-stroke-strong bg-sunken/40 p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink">{title}</h4>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="taskId" value={taskId} />
        {children}
        {state && "error" in state && (
          <p aria-live="polite" className="text-xs font-medium text-risk bg-risk/10 p-2 rounded">
            ⚠️ {state.error}
          </p>
        )}
        {success && (
          <p aria-live="polite" className="text-xs font-medium text-success bg-success/10 p-2 rounded flex items-center gap-1.5">
            <span>✓</span> {success}
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

function DeleteTaskButton({
  projectId,
  taskId,
  onDeleted,
}: {
  projectId: string;
  taskId: string;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    try {
      const res = await deleteTaskAction(prev, fd);
      if (!res) {
        onDeleted();
        router.refresh();
        return null;
      }
      return res;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "删除失败";
      return { error: msg };
    }
  }, null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="shrink-0 rounded border border-risk/30 px-2.5 py-1 text-xs text-risk hover:bg-risk/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risk"
        title="组长专享：删除当前任务"
      >
        🗑️ 删除任务
      </button>
    );
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5 shrink-0">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <span className="text-xs text-risk font-medium">确认删除？</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-risk px-2 py-0.5 text-xs text-white hover:bg-risk/90 disabled:opacity-50"
      >
        {pending ? "删除中…" : "确定"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirming(false)}
        className="rounded border border-stroke px-2 py-0.5 text-xs text-ink-2 hover:bg-panel-hover"
      >
        取消
      </button>
      {state && "error" in state && (
        <span className="text-xs text-risk">{state.error}</span>
      )}
    </form>
  );
}
