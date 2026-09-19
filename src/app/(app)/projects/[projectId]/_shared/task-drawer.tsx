"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  claimTaskAction,
  declineTaskAction,
  reviewTaskAction,
  submitTaskAction,
  type FormState,
} from "../actions";
import { STATUS_LABEL, isAwaitingResponse, isCompleted, isInFlight, isInReview } from "@/lib/task-status";

// 任务抽屉：卡片只用于扫描，完整动作在这里做。
//
// 旧版把编辑表单塞进卡片里，卡片膨胀成「卡里能开一个弹窗里的表单」。
// 抽屉把两者分开：卡片回答「要不要管它」，抽屉回答「怎么管」。
//
// 它由 URL 驱动（`?task=`），所以能深链、能刷新、能前进后退——
// 「今日」页点一条行动，应当一次跳转就能完成那个动作，
// 而不是落到项目页再让人自己找。

export type DrawerTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeKind: "human" | "agent" | null;
  commitmentNote: string | null;
  committedAt: Date | null;
  completionNote: string | null;
  reviewNote: string | null;
  rejectCount: number;
  labels: { id: string; name: string; color: string }[];
};

export function TaskDrawer({
  task,
  projectId,
  currentUserId,
  canWrite,
  canReview,
}: {
  task: DrawerTask;
  projectId: string;
  currentUserId: string;
  canWrite: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 关闭＝从 URL 里摘掉 task 参数。刷新、后退都能正确回到「没打开」的状态
  function close() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("task");
    router.replace(`${pathname}${qs.size ? `?${qs}` : ""}`, { scroll: false });
  }

  function askAi() {
    router.push(`/projects/${projectId}?space=studio&task=${task.id}`);
  }

  // Escape 关闭 + 焦点移入抽屉。Tab 不得穿透到被遮住的背景，关闭后焦点回到来源。
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isMine = task.assigneeId === currentUserId;
  const awaiting = isAwaitingResponse(task.status, task.assigneeId, task.committedAt);

  // 一行只给一个主动作——一屏最多一个高强调动作，这是同一套规则
  const primary = awaiting && isMine
    ? "claim"
    : isMine && isInFlight(task.status)
      ? "submit"
      : canReview && isInReview(task.status) && !isMine
        ? "review"
        : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩。点击关闭是惯例，但 Escape 与关闭按钮才是键盘用户的出路 */}
      <button
        aria-label="关闭任务详情"
        onClick={close}
        className="absolute inset-0 bg-ink/20 transition-opacity duration-200"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`任务详情：${task.title}`}
        className="ac-card ac-float ac-panel-enter relative m-0 h-full w-full max-w-[32rem] overflow-y-auto rounded-none border-y-0 border-r-0 outline-none sm:m-2 sm:h-[calc(100%-1rem)] sm:rounded-[var(--radius-sheet)] sm:border"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-stroke bg-panel px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ac-badge bg-sunken text-ink-2">{STATUS_LABEL[task.status as keyof typeof STATUS_LABEL] ?? task.status}</span>
              {task.rejectCount > 0 && (
                <span className="ac-badge bg-risk-soft text-risk">退回 {task.rejectCount} 次</span>
              )}
            </div>
            <h2 className="mt-1.5 font-display text-lg font-bold leading-snug text-ink">
              {task.title}
            </h2>
          </div>
          <button
            onClick={close}
            aria-label="关闭"
            className="ac-pressable grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <span aria-hidden className="ac-icon-close" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {/* 目标 */}
          <Section title="要达成什么">
            {task.description ? (
              <p className="text-sm leading-6 text-ink-2">{task.description}</p>
            ) : (
              <p className="text-sm text-ink-3">没写说明。</p>
            )}
          </Section>

          {/* 交接 */}
          <Section title="交接">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-ink-3">负责人</dt>
              <dd className="flex items-center gap-1.5 text-ink">
                {task.assigneeName ?? "没人接"}
                {task.assigneeKind === "agent" && <span className="ac-agent-mark">协作者</span>}
              </dd>
              <dt className="text-ink-3">截止</dt>
              <dd className="text-ink">{task.dueDate ?? "未设"}</dd>
            </dl>
            {awaiting && (
              <p className="mt-2 rounded bg-warn-soft px-2 py-1 text-xs text-warn">
                派下去了，但负责人还没回话
              </p>
            )}
            {task.commitmentNote && (
              <p className="mt-2 rounded border-l-2 border-signal/40 bg-signal-soft/50 px-2 py-1 text-xs text-ink-2">
                <span className="text-ink-3">承诺</span> {task.commitmentNote}
              </p>
            )}
            {isCompleted(task.status) && task.completionNote && (
              <p className="mt-2 rounded bg-human-soft px-2 py-1 text-xs text-human">
                完成：{task.completionNote}
              </p>
            )}
            {task.reviewNote && task.status === "doing" && (
              <p className="mt-2 rounded bg-risk-soft px-2 py-1 text-xs text-risk">
                退回意见：{task.reviewNote}
              </p>
            )}
          </Section>

          {/* 动作 */}
          {primary === "claim" && (
            <ActionBlock
              title="这份活你接得住吗"
              hint="接不住也是正当答复——说清为什么，派活的人好改派"
              action={claimTaskAction}
              projectId={projectId}
              taskId={task.id}
              submitLabel="接住"
              fields={
                <textarea
                  name="commitmentNote"
                  required
                  rows={2}
                  placeholder="你打算怎么做？一句话说清路径，事后好对照"
                  className="ac-field text-sm"
                />
              }
              extraAction={
                <AlternateAction
                  action={declineTaskAction}
                  projectId={projectId}
                  taskId={task.id}
                  label="接不住"
                  submitLabel="说明原因并退回"
                  placeholder="比如：这周有三门考试；缺必要的账密"
                />
              }
            />
          )}

          {primary === "submit" && (
            <ActionBlock
              title="交出去"
              hint="交完落到「待验收」，由组长或老师判"
              action={submitTaskAction}
              projectId={projectId}
              taskId={task.id}
              submitLabel="提交待验收"
              fields={
                <textarea
                  name="completionNote"
                  required
                  rows={2}
                  placeholder="这次交付了什么？验收人要凭这句话判断"
                  className="ac-field text-sm"
                />
              }
            />
          )}

          {primary === "review" && (
            <ActionBlock
              title="验收"
              hint="通过则该任务完成；要改就写明改什么"
              action={reviewTaskAction}
              projectId={projectId}
              taskId={task.id}
              submitLabel="提交验收结果"
              fields={
                <>
                  <textarea
                    name="note"
                    rows={2}
                    placeholder="退回时必填：要改什么"
                    className="ac-field text-sm"
                  />
                  <fieldset className="flex gap-4 text-sm text-ink-2">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="decision" value="accept" defaultChecked /> 通过
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="decision" value="reject" /> 退回修改
                    </label>
                  </fieldset>
                </>
              }
            />
          )}

          {!primary && canWrite && (
            <p className="rounded bg-sunken px-3 py-2 text-xs text-ink-3">
              眼下不需要你在这件事上动作。
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-stroke pt-3">
            <button type="button" onClick={askAi} className="ac-btn ac-pressable text-sm">
              在协同室继续
            </button>
            <Link href="#board" onClick={close} className="ac-btn-ghost ac-pressable text-sm">
              回到项目
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function ActionBlock({
  title,
  hint,
  action,
  projectId,
  taskId,
  submitLabel,
  fields,
  extraAction,
}: {
  title: string;
  hint: string;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  projectId: string;
  taskId: string;
  submitLabel: string;
  fields: React.ReactNode;
  extraAction?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  return (
    <section className="rounded-[var(--radius-panel)] border border-stroke-strong bg-sunken/40 p-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-xs leading-5 text-ink-3">{hint}</p>
      <form action={formAction} className="mt-2.5 space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="taskId" value={taskId} />
        {fields}
        {state && "error" in state && (
          <p aria-live="polite" className="text-xs text-risk">
            {state.error}
          </p>
        )}
        <button disabled={pending} className="ac-btn text-sm">
          {pending ? "提交中…" : submitLabel}
        </button>
      </form>
      {extraAction}
    </section>
  );
}

// 「接不住」与「接住」并列同高，不藏在折叠里——
// 它是正当选项，做小了人就不敢点，那正是这个功能要治的病
function AlternateAction({
  action,
  projectId,
  taskId,
  label,
  submitLabel,
  placeholder,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  projectId: string;
  taskId: string;
  label: string;
  submitLabel: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ac-btn-ghost mt-2 w-full text-sm"
      >
        {label}
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2 border-t border-stroke pt-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <textarea name="reason" required rows={2} placeholder={placeholder} className="ac-field text-sm" />
      {state && "error" in state && (
        <p aria-live="polite" className="text-xs text-risk">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button disabled={pending} className="ac-btn text-sm">
          {pending ? "提交中…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="text-xs text-ink-3 hover:text-ink"
        >
          取消
        </button>
      </div>
    </form>
  );
}
