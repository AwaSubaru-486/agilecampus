"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { createTaskAction, type CreateTaskState } from "./actions";
import { DEFAULT_STATUS, statusLabel, type TaskStatus } from "@/lib/task-status";

export function NewTaskForm({
  compact = false,
  projectId,
  members,
  milestones,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
  dialog = false,
}: {
  compact?: boolean;
  projectId: string;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  dialog?: boolean;
}) {
  const [state, formAction, pending] = useActionState<CreateTaskState, FormData>(
    createTaskAction,
    null,
  );
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);
  const [targetStatus, setTargetStatus] = useState<TaskStatus>(DEFAULT_STATUS);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const lastTabDirection = useRef<"forward" | "backward">("forward");
  const created = Boolean(state && "ok" in state);

  useEffect(() => {
    if (open) requestAnimationFrame(() => titleRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!dialog || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!pending) setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      lastTabDirection.current = event.shiftKey ? "backward" : "forward";

      const section = dialogRef.current;
      if (!section) return;
      const focusable = Array.from(section.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      )).filter((element) =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden" &&
        (!element.closest("details:not([open])") || element.matches("summary")) &&
        !element.closest('[aria-hidden="true"]'),
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!section.contains(active) || (event.shiftKey && active === first)) {
        event.preventDefault();
        event.stopPropagation();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        // Native date inputs use several internal keyboard stops while keeping
        // the same activeElement. Let the browser finish those before trapping.
        if (active instanceof HTMLInputElement && active.type === "date") return;
        event.preventDefault();
        event.stopPropagation();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const section = dialogRef.current;
      if (!section?.isConnected || section.contains(event.target as Node)) return;
      const focusable = Array.from(section.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      )).filter((element) =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden" &&
        (!element.closest("details:not([open])") || element.matches("summary")) &&
        !element.closest('[aria-hidden="true"]'),
      );
      const target = lastTabDirection.current === "backward" ? focusable.at(-1) : focusable[0];
      if (!target) return;
      event.stopPropagation();
      target.focus();
    };
    // Capture before page-level/React handlers so focus cannot escape into
    // background controls when the modal is nested in an interactive board.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  }, [dialog, open, pending, setOpen]);

  useEffect(() => {
    function openComposer(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        event.key !== "+" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) return;
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => titleRef.current?.focus());
    }
    window.addEventListener("keydown", openComposer);
    return () => window.removeEventListener("keydown", openComposer);
  }, [setOpen]);

  useEffect(() => {
    function openForColumn(event: Event) {
      const status = (event as CustomEvent<{ status?: TaskStatus }>).detail?.status;
      setTargetStatus(status ?? DEFAULT_STATUS);
      setOpen(true);
      requestAnimationFrame(() => titleRef.current?.focus());
    }
    window.addEventListener("agilecampus:new-task", openForColumn);
    return () => window.removeEventListener("agilecampus:new-task", openForColumn);
  }, [setOpen]);

  function begin() {
    setTargetStatus(DEFAULT_STATUS);
    setOpen(true);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  const form = (
    <form
      key={state && "ok" in state ? state.revision : "new-task"}
      action={formAction}
      onKeyDown={(event) => {
        if (!dialog && event.key === "Escape" && !pending) setOpen(false);
      }}
      className="space-y-3 border-y border-line bg-surface p-3"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="status" value={targetStatus} />
      {targetStatus !== "todo" && (
        <p className="text-xs font-medium text-primary">
          将添加到“{statusLabel(targetStatus)}”
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={titleRef}
          required
          name="title"
          placeholder="要完成什么？"
          className="ac-field flex-1"
        />
        <button disabled={pending} className="ac-btn shrink-0 px-3 py-2 text-sm">
          {pending ? "添加中…" : "添加"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="ac-btn-ghost px-2.5 py-2"
        >
          取消
        </button>
      </div>

      <details className="group border-y border-line bg-sunken/50 px-3 py-2">
        <summary className="cursor-pointer list-none text-xs font-medium text-ink-soft">
          更多设置 <span className="text-ink-faint group-open:hidden">（负责人、日期、优先级）</span>
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <textarea
            name="description"
            placeholder="任务说明（可选）"
            rows={2}
            className="ac-field sm:col-span-2 lg:col-span-3"
          />
          <select name="assigneeId" defaultValue="" className="ac-field text-sm">
            <option value="">未分配</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select name="milestoneId" defaultValue="" className="ac-field text-sm">
            <option value="">无里程碑</option>
            {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <select name="priority" defaultValue="medium" className="ac-field text-sm">
            <option value="low">低优先级</option>
            <option value="medium">中优先级</option>
            <option value="high">高优先级</option>
          </select>
          <label className="space-y-1 text-xs text-ink-faint">
            开始日期
            <input type="date" name="startDate" className="ac-field text-sm" />
          </label>
          <label className="space-y-1 text-xs text-ink-faint">
            截止日期
            <input type="date" name="dueDate" className="ac-field text-sm" />
          </label>
        </div>
      </details>

      {state && "error" in state && (
        <p aria-live="polite" className="text-sm text-high">{state.error}</p>
      )}
      {created && (
        <p aria-live="polite" className="text-xs text-done">任务已添加，可以继续录入下一项。</p>
      )}
    </form>
  );

  return (
    <div id={dialog ? undefined : "quick-task"} className={dialog ? undefined : "scroll-mt-20"}>
      {showTrigger && !open && (
        <button
          type="button"
          onClick={begin}
          className={compact
            ? "ac-btn-ghost min-h-8 px-2.5 text-xs"
            : "flex w-full items-center justify-between border border-line-strong bg-surface px-3 py-2.5 text-left text-sm text-ink-soft transition hover:border-stroke-strong hover:bg-sunken hover:text-ink"}
        >
          <span><span className="mr-1.5 font-semibold">＋</span>{compact ? "新任务" : "快速添加任务"}</span>
          {!compact && <span className="hidden text-xs text-ink-faint sm:inline">按 + 唤起</span>}
        </button>
      )}
      {open && (dialog ? (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:items-center"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false); }}
        >
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-task-title" tabIndex={-1} className="w-full max-w-2xl border border-stroke bg-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-stroke px-4 py-3">
              <h2 id="new-task-title" className="text-sm font-semibold text-ink">新建任务</h2>
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className="ac-btn-ghost px-2.5 py-1.5 text-xs">关闭</button>
            </div>
            {form}
          </section>
        </div>
      ) : form)}
    </div>
  );
}
