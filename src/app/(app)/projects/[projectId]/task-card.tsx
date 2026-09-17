"use client";

import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import {
  claimTaskAction,
  deleteTaskAction,
  reviewTaskAction,
  submitTaskAction,
  updateTaskAction,
  type FormState,
  type UpdateTaskState,
} from "./actions";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import { isCompleted, isInFlight, isInReview } from "@/lib/task-status";
import type { BoardTask } from "./board";
import type { CardDensity } from "./board";

export type Option = { id: string; name: string };
type TaskOption = { id: string; title: string };

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
};

const PRIORITY_LABEL: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

const PRIORITY_RAIL: Record<string, string> = {
  high: "before:bg-high",
  medium: "before:bg-medium",
  low: "before:bg-low",
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
}) {
  const [editing, setEditing] = useState(false);
  // 动作面板：同一时刻只开一个。null 表示无
  const [panel, setPanel] = useState<null | "claim" | "submit" | "review">(null);

  // 三枚动作各按「我能不能做这件事」判定。做不了的不显示，
  // 比显示了再报错友好——尤其对初次使用的人。
  const isMine = task.assigneeId === currentUserId;
  const canClaim = canWrite && isInFlight(task.status) && !task.assigneeId;
  const canSubmit = isMine && isInFlight(task.status);
  // 不能验收自己的活：既不能自证，也不能自判
  const canReviewThis = canReview && isInReview(task.status) && !isMine;
  const searchParams = useSearchParams();
  // 深链 /projects/[id]?task=<taskId>：命中本卡片则打开详情弹窗（仅 canWrite 有 EditModal）。
  // 于渲染期调整而非 useEffect：避免多渲染一轮，且用户手动关闭后不会被 effect 重开。
  const deepLinked = canWrite && searchParams.get("task") === task.id;
  const [prevDeepLinked, setPrevDeepLinked] = useState(false);
  if (deepLinked !== prevDeepLinked) {
    setPrevDeepLinked(deepLinked);
    if (deepLinked) setEditing(true);
  }
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite || editing,
  });
  const successorTitles = dependencies
    .filter((d) => d.predecessorId === task.id)
    .map((d) => allTasks.find((t) => t.id === d.successorId)?.title)
    .filter(Boolean);

  function askAi() {
    window.dispatchEvent(new CustomEvent("agilecampus:ask-ai", {
      detail: { taskId: task.id, title: task.title },
    }));
    document.getElementById("ai-collaboration")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={`ac-card group relative select-none overflow-hidden ${density === "compact" ? "p-2.5" : "p-3.5"} text-sm before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full transition-[box-shadow,transform,opacity,border-color] duration-150 will-change-transform hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md ${PRIORITY_RAIL[task.priority] ?? PRIORITY_RAIL.low} ${
        isDragging ? "scale-[0.98] opacity-20" : ""
      }`}
    >
      <div
        {...listeners}
        {...attributes}
        className={canWrite && !editing ? "cursor-grab touch-none active:cursor-grabbing" : ""}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-ink-faint">TASK {task.id.slice(0, 4).toUpperCase()}</p>
            <p className="font-medium leading-5 text-ink">{task.title}</p>
          </div>
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-[10px] font-semibold text-ink-soft" title={task.assigneeName ?? "未分配"}>
            {(task.assigneeName ?? "?").slice(0, 1).toUpperCase()}
          </span>
        </div>
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          <span>{task.assigneeName ?? "待认领"}</span>
          {(task.startDate || task.dueDate) && (
            <span>· {task.dueDate ?? task.startDate}</span>
          )}
          <span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? "bg-low-soft text-low"}`}>
            {PRIORITY_LABEL[task.priority] ?? task.priority}
          </span>
        </p>
        {density === "comfortable" && task.labels.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            {task.labels.slice(0, 3).map((l) => (
              <span
                key={l.id}
                className={`ac-badge ${LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}`}
              >
                {l.name}
              </span>
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
            className={`mt-1 rounded px-2 py-1 text-xs ${
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
          <p className="mt-1.5 rounded border-l-2 border-primary/40 bg-primary-soft/50 px-2 py-1 text-xs text-ink-soft">
            <span className="text-ink-faint">承诺</span> {task.commitmentNote}
            {task.estimatedHours ? (
              <span className="ml-1 text-ink-faint">· 预估 {task.estimatedHours} 小时</span>
            ) : null}
          </p>
        )}
        {/* 退回意见要显眼：成员最需要知道的就是「哪里不行」 */}
        {task.status === "doing" && task.reviewNote && (
          <p className="mt-1.5 rounded bg-high-soft px-2 py-1 text-xs text-high">
            退回意见：{task.reviewNote}
          </p>
        )}
      </div>

      <div className="mt-3 space-y-2 border-t border-line pt-2">
        {/* 主行动区：做不了的动作不显示。这三枚是闭环的入口，
            故常驻可见，不像下面两个次要链接那样要悬停才现身 */}
        {(canClaim || canSubmit || canReviewThis) && (
          <div className="flex flex-wrap gap-1.5">
            {canClaim && (
              <button
                type="button"
                onClick={() => setPanel(panel === "claim" ? null : "claim")}
                className="ac-btn px-2.5 py-1 text-xs"
              >
                我接手
              </button>
            )}
            {canSubmit && (
              <button
                type="button"
                onClick={() => setPanel(panel === "submit" ? null : "submit")}
                className="ac-btn px-2.5 py-1 text-xs"
              >
                提交成果
              </button>
            )}
            {canReviewThis && (
              <button
                type="button"
                onClick={() => setPanel(panel === "review" ? null : "review")}
                className="ac-btn bg-review px-2.5 py-1 text-xs hover:bg-review/90"
              >
                验收
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {canWrite && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-ink-faint hover:text-primary hover:underline"
            >
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={askAi}
            className="text-xs text-ink-faint hover:text-primary hover:underline"
          >
            带此任务问 AI
          </button>
        </div>
      </div>

      {panel === "claim" && (
        <ActionForm
          action={claimTaskAction}
          projectId={projectId}
          taskId={task.id}
          submitLabel="认下这件活"
          onDone={() => setPanel(null)}
          onCancel={() => setPanel(null)}
        >
          <label className="block space-y-1 text-xs text-ink-faint">
            你打算怎么做？
            <textarea
              name="commitmentNote"
              required
              rows={2}
              placeholder="一句话说清路径，事后好对照"
              className="ac-field text-sm"
            />
          </label>
          <label className="block space-y-1 text-xs text-ink-faint">
            预估工时（小时，选填）
            <input type="number" name="estimatedHours" min="0.5" step="0.5" className="ac-field text-sm" />
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
            这次交付了什么？
            <textarea
              name="completionNote"
              required
              rows={2}
              placeholder="验收人要凭这句话判断，请写清成果与去向"
              className="ac-field text-sm"
            />
          </label>
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
          <label className="block space-y-1 text-xs text-ink-faint">
            验收意见（退回时必填）
            <textarea
              name="note"
              rows={2}
              placeholder="退回请写明要改什么，否则成员只知道被否了"
              className="ac-field text-sm"
            />
          </label>
          <fieldset className="flex gap-3 text-xs text-ink-soft">
            <label className="flex items-center gap-1">
              <input type="radio" name="decision" value="accept" defaultChecked /> 通过
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="decision" value="reject" /> 退回修改
            </label>
          </fieldset>
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
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await action(prev, fd);
    if (!res) onDone();
    return res;
  }, null);

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-lg bg-sunken p-2.5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      {children}
      {state && "error" in state && (
        <p aria-live="polite" className="text-xs text-high">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button disabled={pending} className="ac-btn px-2.5 py-1 text-xs">
          {pending ? "提交中…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-xs text-ink-faint hover:text-primary"
        >
          取消
        </button>
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
            ✕
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
            <button type="button" onClick={onClose} className="ac-btn-ghost">
              取消
            </button>
            <button disabled={updating} className="ac-btn">
              {updating ? "保存中…" : "保存"}
            </button>
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
