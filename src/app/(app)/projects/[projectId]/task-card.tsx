"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import {
  claimTaskAction,
  declineTaskAction,
  deleteTaskAction,
  reviewTaskAction,
  submitTaskAction,
  updateTaskAction,
  type FormState,
  type UpdateTaskState,
} from "./actions";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import { isAwaitingResponse, isCompleted, isInFlight, isInReview } from "@/lib/task-status";
import type { BoardTask } from "./board";
import type { CardDensity } from "./board";
import { Badge, Button } from "@/components/ui";
import { RequiredEvidenceFields, missingRequiredEvidenceTypes } from "./_shared/required-evidence-fields";

// 负责人下拉的每一项。kind 决定卡面上是否给它挂「AI」标识——
// 人机混排的界面里，一眼分得清谁是谁是基本要求。
export type Option = { id: string; name: string; kind?: "human" | "agent" };
type TaskOption = { id: string; title: string };

const PRIORITY_LABEL: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

export function TaskCard({
  task,
  projectId,
  canWrite,
  canReview,
  currentUserId,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
  density = "comfortable",
  dragEnabled = true,
  listMode = false,
}: {
  task: BoardTask;
  projectId: string;
  canWrite: boolean;
  /** 组长或教师：可验收。与 canWrite 并列而非包含——教师能验收却仍不能编辑 */
  canReview: boolean;
  currentUserId: string;
  members: Option[];
  milestones: Option[];
  allTasks: TaskOption[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
  density?: CardDensity;
  /** 状态分组时关闭拖拽；状态推进必须走认领/提交/验收动作。 */
  dragEnabled?: boolean;
  /** 列表视图使用平铺行，避免每一项变成独立的装饰卡片。 */
  listMode?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // 动作面板：同一时刻只开一个。null 表示无
  const [panel, setPanel] = useState<null | "claim" | "submit" | "review" | "decline">(null);

  // 三枚动作各按「我能不能做这件事」判定。做不了的不显示，
  // 比显示了再报错友好——尤其对初次使用的人。
  const isMine = task.assigneeId === currentUserId;
  const isAdmin = canWrite && canReview;
  const hasCurrentCommitment = Boolean(task.committedAt) &&
    task.committedHandoffVersion === task.handoffVersion;
  const canClaim = canWrite && isInFlight(task.status) &&
    ((!task.assigneeId && isAdmin) || (isMine && !hasCurrentCommitment));
  const canSubmit = canWrite && isMine && isInFlight(task.status) && hasCurrentCommitment;
  const missingEvidenceTypes = missingRequiredEvidenceTypes(
    task.requiredEvidence,
    task.evidenceTypes,
  );
  // 组长（admin）可闭环验收所有待验收任务（含自己承接的活）；普通教师只能验收他人交付的活，避免自审自判
  const canReviewThis = canReview && isInReview(task.status) && (isAdmin || !isMine);

  // 「还没接住」——派下去但本人没回话。看板上要看得见，
  // 否则它会伪装成「有人在做了」，一路蒙到 deadline
  const awaitingResponse = isAwaitingResponse(task.status, task.assigneeId, task.committedAt);
  const canDecline = canWrite && isMine && awaitingResponse;

  // 负责人是不是 agent：查名录里的 kind，卡片不做额外请求
  const assigneeIsAgent = members.some((m) => m.id === task.assigneeId && m.kind === "agent");

  // agent 此刻的状态译成一句人话。只在负责人是 agent 时显示，
  // 免得给人也挂一个「离线」——人不会被判离线。
  const agentBadge: { label: string; tone: "agent" | "risk" | "neutral" } | null = !assigneeIsAgent
    ? null
    : task.hasActiveRun
      ? { label: "AI 执行中", tone: "agent" }
      : task.agentStatus === "blocked"
        ? { label: "AI 阻塞", tone: "risk" }
        : task.agentStatus === "error"
        ? { label: "AI 执行失败", tone: "risk" }
          : task.agentStatus === "offline"
            ? { label: "AI 离线", tone: "neutral" }
            : null;
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !dragEnabled || !canWrite || editing,
  });
  const successorTitles = dependencies
    .filter((d) => d.predecessorId === task.id)
    .map((d) => allTasks.find((t) => t.id === d.successorId)?.title)
    .filter(Boolean);

  function askAi() {
    router.push(`/projects/${projectId}?space=studio&task=${task.id}`);
  }

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={`group relative select-none overflow-hidden text-sm transition-[background-color,border-color,opacity] duration-150 ${
        listMode
          ? "border-0 border-b border-stroke bg-transparent px-3 py-3 hover:bg-sunken/60"
          : `border border-stroke bg-panel ${density === "compact" ? "p-2.5" : "p-3.5"}`
      } ${
        isDragging ? "scale-[0.98] opacity-20" : ""
      }`}
    >
      <div
        {...listeners}
        {...attributes}
        className={dragEnabled && canWrite && !editing ? "cursor-grab touch-none active:cursor-grabbing" : ""}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-ink-faint">任务 {task.id.slice(0, 4).toUpperCase()}</p>
            <p className="font-medium leading-5 text-ink">{task.title}</p>
          </div>
          <span className="grid size-7 shrink-0 place-items-center border border-line bg-sunken text-[10px] font-semibold text-ink-soft" title={task.assigneeName ?? "未分配"}>
            {(task.assigneeName ?? "?").slice(0, 1).toUpperCase()}
          </span>
        </div>
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          <span>{task.assigneeName ?? "待认领"}</span>
          {assigneeIsAgent && <span className="ac-agent-mark">AI</span>}
          {/* agent 此刻在干什么。这一格是人机混排界面的关键——
              人说得出自己卡住了，agent 不会，只能靠这一格替他开口 */}
          {agentBadge && (
            <Badge tone={agentBadge.tone}>{agentBadge.label}</Badge>
          )}
          {(task.startDate || task.dueDate) && (
            <span>截止：{task.dueDate ?? task.startDate}</span>
          )}
          <Badge tone={priorityTone(task.priority)}>
            {PRIORITY_LABEL[task.priority] ?? task.priority}
          </Badge>
        </p>
        {/* 还没接住：派了不等于有人接。一句话点破这层误会 */}
        {awaitingResponse && (
          <p className="mt-1.5 rounded border border-medium/30 bg-medium-soft/60 px-2 py-1 text-xs text-medium">
            {assigneeIsAgent ? "派给 AI 了，但它还没回话" : "已指派，等本人回复接不接"}
          </p>
        )}
        {density === "comfortable" && task.labels.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            {task.labels.slice(0, 3).map((l) => (
              <Badge
                key={l.id}
                className={LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}
              >
                {l.name}
              </Badge>
            ))}
            {task.labels.length > 3 && (
              <span className="text-xs text-ink-faint">+{task.labels.length - 3}</span>
            )}
          </p>
        )}
        {density === "comfortable" && task.description && (
          <p className="mt-1 text-xs text-ink-soft line-clamp-2">{task.description}</p>
        )}
        {/* 提交验收时正是要填完成说明的时刻，故只要交出去了（含待验收）就得显示，
            不能等到 done——否则成员填了却看不见自己填了什么 */}
        {density === "comfortable" && !isInFlight(task.status) && task.completionNote && (
          <p
            className={`mt-1 rounded border border-stroke px-2 py-1 text-xs ${
              isCompleted(task.status) ? "bg-done/10 text-done" : "bg-review-soft text-review"
            }`}
          >
            {isCompleted(task.status) ? "完成情况" : "已提交"}：{task.completionNote}
          </p>
        )}
        {density === "comfortable" && successorTitles.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">后置：{successorTitles.join("、")}</p>
        )}
        {/* 承诺常驻展示——这是「承诺」这个概念唯一能被看见的地方。
            紧凑态省掉，免得卡片过高 */}
        {density === "comfortable" && task.commitmentNote && (
          <p className="mt-1.5 rounded border border-stroke bg-sunken px-2 py-1 text-xs text-ink-soft">
            <span className="text-ink-faint">承诺</span> {task.commitmentNote}
            {task.estimatedHours ? (
              <span className="ml-3 text-ink-faint">预估：{task.estimatedHours} 小时</span>
            ) : null}
          </p>
        )}
        {/* 退回意见要显眼：成员最需要知道的就是「哪里不行」 */}
        {task.status === "doing" && task.reviewNote && (
          <p className="mt-1.5 rounded border border-high/30 bg-high-soft px-2 py-1 text-xs text-high">
            退回意见：{task.reviewNote}
          </p>
        )}
        {isInReview(task.status) && !canReviewThis && (
          <p className="mt-1.5 border border-line bg-sunken px-2 py-1 text-xs text-ink-soft">
            {isMine
              ? "已提交，需由其他组长或教师验收"
              : "待组长或教师验收"}
          </p>
        )}
      </div>

      <div className="mt-3 space-y-2 border-t border-line pt-2">
        {/* 主行动区：做不了的动作不显示。这三枚是闭环的入口，
            故常驻可见，不像下面两个次要链接那样要悬停才现身 */}
        {/* 主行动区：做不了的动作不显示。这三枚是闭环的入口，
            故常驻可见，不像下面两个次要链接那样要悬停才现身 */}
        {(canClaim || canSubmit || canReviewThis) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {canClaim && (
              <div className="inline-flex items-center gap-1">
                <QuickActionButton
                  action={claimTaskAction}
                  projectId={projectId}
                  taskId={task.id}
                  payload={{ commitmentNote: "已确认接住并认领任务" }}
                  label={isMine && task.committedAt ? "⚡ 重新确认" : "⚡ 接住"}
                  pendingLabel="接手中…"
                  variant="ink"
                  title="一键接住并开始执行任务"
                />
                <Button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPanel(panel === "claim" ? null : "claim");
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  variant="quiet"
                  size="sm"
                  className="px-1.5 text-xs text-ink-faint hover:text-ink"
                  title="展开填写定制执行计划与预估工时"
                >
                  {panel === "claim" ? "收起" : isMine && task.committedAt ? "重新承诺…" : "写承诺…"}
                </Button>
              </div>
            )}
            {canSubmit && (
              <div className="inline-flex items-center gap-1">
                <QuickActionButton
                  action={submitTaskAction}
                  projectId={projectId}
                  taskId={task.id}
                  payload={{ completionNote: "已完成任务并提交成果物待验收" }}
                  label="⚡ 提交待验收"
                  pendingLabel="提交中…"
                  variant="ink"
                  title="一键将任务提交待验收"
                />
                <Button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPanel(panel === "submit" ? null : "submit");
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  variant="quiet"
                  size="sm"
                  className="px-1.5 text-xs text-ink-faint hover:text-ink"
                  title="展开填写交付说明与成果物去向"
                >
                  {panel === "submit" ? "收起" : "写交付说明…"}
                </Button>
              </div>
            )}
            {canReviewThis && (
              <div className="inline-flex items-center gap-1">
                <QuickActionButton
                  action={reviewTaskAction}
                  projectId={projectId}
                  taskId={task.id}
                  payload={{ decision: "accept", note: "验收通过" }}
                  label="✓ 通过"
                  pendingLabel="通过中…"
                  variant="secondary"
                  className="border-agent text-agent hover:bg-agent-soft font-semibold"
                  title="一键验收通过此任务"
                />
                <QuickActionButton
                  action={reviewTaskAction}
                  projectId={projectId}
                  taskId={task.id}
                  payload={{ decision: "reject", note: "退回修改，请完善成果物后重新提交" }}
                  label="↩ 退回"
                  pendingLabel="退回中…"
                  variant="quiet"
                  className="border border-rose-200 bg-rose-50/60 text-rose-700 hover:bg-rose-100/70 font-semibold"
                  title="一键退回此任务到进行中"
                />
                <Button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPanel(panel === "review" ? null : "review");
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  variant="quiet"
                  size="sm"
                  className="px-1.5 text-xs text-ink-faint hover:text-ink"
                  title="展开填写详细评语或退回修改说明"
                >
                  {panel === "review" ? "收起" : "写评语…"}
                </Button>
              </div>
            )}
            {/* 「接不住」与「我接手」并列同高：它是正当选项，不是失败按钮。
                做小做灰，人就又不敢点了——那正是这个功能要治的病 */}
            {canDecline && (
              <Button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPanel(panel === "decline" ? null : "decline");
                }}
                onPointerDown={(e) => e.stopPropagation()}
                variant="secondary"
                size="sm"
              >
                接不住
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/projects/${projectId}?space=work&task=${task.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            className="ac-pressable inline-flex min-h-9 items-center text-xs font-medium text-signal hover:text-signal-hover"
          >
            查看任务
          </Link>
          {canWrite && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ac-pressable min-h-9 text-xs text-ink-faint hover:text-primary hover:underline"
            >
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={askAi}
            className="ac-pressable min-h-9 text-xs text-ink-faint hover:text-primary hover:underline"
          >
            继续协作
          </button>
        </div>
      </div>

      {panel === "claim" && (
        <ActionForm
          action={claimTaskAction}
          projectId={projectId}
          taskId={task.id}
          submitLabel="确认接住此活"
          onDone={() => setPanel(null)}
          onCancel={() => setPanel(null)}
        >
          <label className="block space-y-1 text-xs text-ink-faint">
            执行承诺与计划（选填）
            <textarea
              name="commitmentNote"
              rows={2}
              placeholder="一句话说清路径（选填，默认：已确认接住并认领任务）"
              className="ac-field text-sm"
            />
          </label>
          <label className="block space-y-1 text-xs text-ink-faint">
            预估工时（小时，选填）
            <input type="number" name="estimatedHours" min="0.5" step="0.5" className="ac-field text-sm" />
          </label>
        </ActionForm>
      )}

      {panel === "decline" && (
        <ActionForm
          action={declineTaskAction}
          projectId={projectId}
          taskId={task.id}
          submitLabel="说明原因并退回"
          onDone={() => setPanel(null)}
          onCancel={() => setPanel(null)}
        >
          <p className="text-xs leading-5 text-ink-soft">
            接不住不是失败，是让派活的人早点知道。退回后任务回到「待办」，
            派活的人会收到通知，可以改派、拆小或换个做法。
          </p>
          <label className="block space-y-1 text-xs text-ink-faint">
            为什么接不住
            <textarea
              name="reason"
              required
              rows={2}
              placeholder="比如：这周有三门考试；缺必要的账密；不清楚要做到什么程度"
              className="ac-field text-sm"
            />
          </label>
        </ActionForm>
      )}

      {panel === "submit" && (
        <ActionForm
          action={submitTaskAction}
          projectId={projectId}
          taskId={task.id}
          submitLabel="提交待验收"
          onDone={() => setPanel(null)}
          onCancel={() => setPanel(null)}
        >
          <label className="block space-y-1 text-xs text-ink-faint">
            这次交付了什么？（选填）
            <textarea
              name="completionNote"
              rows={2}
              placeholder="说明交付成果与去向（选填，默认：已完成任务并提交成果物待验收）"
              className="ac-field text-sm"
            />
          </label>
          <RequiredEvidenceFields types={missingEvidenceTypes} />
        </ActionForm>
      )}

      {panel === "review" && (
        <ActionForm
          action={reviewTaskAction}
          projectId={projectId}
          taskId={task.id}
          submitLabel="提交验收结果"
          onDone={() => setPanel(null)}
          onCancel={() => setPanel(null)}
        >
          <fieldset className="flex gap-4 text-xs text-ink-soft">
            <label className="flex items-center gap-1.5 cursor-pointer font-medium text-signal">
              <input type="radio" name="decision" value="accept" defaultChecked /> ✓ 通过验收
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer font-medium text-rose-700">
              <input type="radio" name="decision" value="reject" /> ↩ 退回修改
            </label>
          </fieldset>
          <label className="block space-y-1 text-xs text-ink-faint">
            验收意见 / 修改要求（选填）
            <textarea
              name="note"
              rows={2}
              placeholder="通过可留空（默认：验收通过）；退回可写明要改什么（默认：退回修改，请完善成果物后重新提交）"
              className="ac-field text-sm"
            />
          </label>
        </ActionForm>
      )}

      {editing && (
        <EditModal
          task={task}
          projectId={projectId}
          members={members}
          milestones={milestones}
          allTasks={allTasks}
          allLabels={allLabels}
          dependencies={dependencies}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// 一键式快速动作：直接提交预置载荷，立即触发服务端流转与看板刷新
function QuickActionButton({
  action,
  projectId,
  taskId,
  payload,
  label,
  pendingLabel = "提交中…",
  variant = "ink",
  className,
  title,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  projectId: string;
  taskId: string;
  payload: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "ink" | "secondary" | "quiet";
  className?: string;
  title?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await action(prev, fd);
    if (!res) {
      router.refresh();
    }
    return res;
  }, null);

  return (
    <form
      action={formAction}
      className="inline-block"
      onSubmit={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      {Object.entries(payload).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button
        type="submit"
        disabled={pending}
        variant={variant}
        size="sm"
        className={className}
        title={title}
      >
        {pending ? pendingLabel : label}
      </Button>
      {state && "error" in state && (
        <span className="ml-1 text-[10px] text-high">{state.error}</span>
      )}
    </form>
  );
}

// 承诺/提交/验收三个面板共用同一副骨架，只有字段与按钮文案不同。
// 服务端 action 成功时返回 null，据此关闭面板——比让用户自己再点一次取消友好。
function ActionForm({
  action,
  projectId,
  taskId,
  submitLabel,
  onDone,
  onCancel,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  projectId: string;
  taskId: string;
  submitLabel: string;
  onDone: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    try {
      const res = await action(prev, fd);
      if (!res) {
        router.refresh();
        onDone();
        return null;
      }
      return res;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "操作失败，请重试";
      return { error: msg };
    }
  }, null);

  return (
    <form
      action={formAction}
      className="mt-2 space-y-2 border-t border-line bg-sunken/50 py-2.5"
      onSubmit={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      {children}
      {state && "error" in state && (
        <p aria-live="polite" className="text-xs text-high">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "提交中…" : submitLabel}
        </Button>
        <Button
          type="button"
          onClick={onCancel}
          disabled={pending}
          variant="quiet"
          size="sm"
        >
          取消
        </Button>
      </div>
    </form>
  );
}

function EditModal({
  task,
  projectId,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
  onClose,
}: {
  task: BoardTask;
  projectId: string;
  members: Option[];
  milestones: Option[];
  allTasks: TaskOption[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
  onClose: () => void;
}) {
  const [updateState, updateFormAction, updating] = useActionState<UpdateTaskState, FormData>(
    updateTaskAction,
    null,
  );
  const [deleteState, deleteFormAction, deleting] = useActionState<FormState, FormData>(
    deleteTaskAction,
    null,
  );

  // 保存成功（action 回 { ok: true }）即关窗
  useEffect(() => {
    if (updateState && "ok" in updateState) onClose();
  }, [updateState, onClose]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const updateError = updateState && "error" in updateState ? updateState.error : null;
  const deleteError = deleteState && "error" in deleteState ? deleteState.error : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="编辑任务"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-ink/45 backdrop-blur-sm"
      />
      <div className="relative z-10 my-auto w-full max-w-md ac-card p-5 shadow-pop">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-ink">编辑任务</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-field text-ink-faint hover:bg-sunken hover:text-ink"
          >
            <span aria-hidden className="ac-icon-close" />
          </button>
        </header>

        <form action={updateFormAction} className="space-y-2.5">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="projectId" value={projectId} />

          <Field label="标题">
            <input name="title" defaultValue={task.title} className="ac-field text-sm" />
          </Field>
          <Field label="描述">
            <textarea
              name="description"
              defaultValue={task.description ?? ""}
              rows={2}
              className="ac-field text-sm"
              placeholder="任务描述"
            />
          </Field>
          <Field label="完成情况（完成时填写）">
            <textarea
              name="completionNote"
              defaultValue={task.completionNote ?? ""}
              rows={2}
              className="ac-field text-sm"
              placeholder="完成说明"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="负责人">
              <select name="assigneeId" defaultValue={task.assigneeId ?? ""} className="ac-field text-sm">
                <option value="">未分配</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="里程碑">
              <select name="milestoneId" defaultValue={task.milestoneId ?? ""} className="ac-field text-sm">
                <option value="">无里程碑</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="优先级">
              <select name="priority" defaultValue={task.priority} className="ac-field text-sm">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </Field>
            <Field label="起始日">
              <input type="date" name="startDate" defaultValue={task.startDate ?? ""} className="ac-field text-sm" />
            </Field>
            <Field label="截止日">
              <input type="date" name="dueDate" defaultValue={task.dueDate ?? ""} className="ac-field text-sm" />
            </Field>
          </div>

          {allLabels.length > 0 && (
            <Field label="标签（可多选）">
              <select
                multiple
                name="labelIds"
                defaultValue={task.labels.map((l) => l.id)}
                className="ac-field text-sm"
                size={Math.min(4, Math.max(2, allLabels.length))}
              >
                {allLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="后置任务（可多选）">
            <select
              multiple
              name="successorIds"
              defaultValue={dependencies
                .filter((d) => d.predecessorId === task.id)
                .map((d) => d.successorId)}
              className="ac-field text-sm"
              size={Math.min(4, Math.max(2, allTasks.length - 1))}
            >
              {allTasks
                .filter((t) => t.id !== task.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </Field>

          {updateError && <p className="text-sm text-high">{updateError}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose} variant="secondary">
              取消
            </Button>
            <Button type="submit" disabled={updating}>
              {updating ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>

        <form
          action={deleteFormAction}
          onSubmit={(e) => {
            if (!confirm("确认删除该任务？此操作不可恢复。")) e.preventDefault();
          }}
          className="mt-3 border-t border-line pt-3"
        >
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="projectId" value={projectId} />
          {deleteError && <p className="mb-1 text-xs text-high">{deleteError}</p>}
          <button
            disabled={deleting}
            className="text-xs text-high underline disabled:opacity-50"
          >
            删除任务
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function priorityTone(priority: string): "risk" | "warn" | "neutral" {
  if (priority === "high") return "risk";
  if (priority === "medium") return "warn";
  return "neutral";
}
