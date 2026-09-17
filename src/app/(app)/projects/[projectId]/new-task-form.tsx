"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createTaskAction, type CreateTaskState } from "./actions";
import { DEFAULT_STATUS, statusLabel, type TaskStatus } from "@/lib/task-status";

export function NewTaskForm({
  projectId,
  members,
  milestones,
}: {
  projectId: string;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState<CreateTaskState, FormData>(
    createTaskAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<TaskStatus>(DEFAULT_STATUS);
  const titleRef = useRef<HTMLInputElement>(null);
  const created = Boolean(state && "ok" in state);

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
  }, []);

  useEffect(() => {
    function openForColumn(event: Event) {
      const status = (event as CustomEvent<{ status?: TaskStatus }>).detail?.status;
      setTargetStatus(status ?? DEFAULT_STATUS);
      setOpen(true);
      requestAnimationFrame(() => titleRef.current?.focus());
    }
    window.addEventListener("agilecampus:new-task", openForColumn);
    return () => window.removeEventListener("agilecampus:new-task", openForColumn);
  }, []);

  function begin() {
    setTargetStatus(DEFAULT_STATUS);
    setOpen(true);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  return (
    <div id="quick-task" className="scroll-mt-20">
      {!open ? (
        <button
          type="button"
          onClick={begin}
          className="flex w-full items-center justify-between rounded-xl border border-dashed border-line-strong bg-surface px-3 py-2.5 text-left text-sm text-ink-soft transition hover:border-primary hover:bg-primary-soft hover:text-primary"
        >
          <span><span className="mr-2 font-semibold">＋</span>快速添加任务</span>
          <span className="hidden text-xs text-ink-faint sm:inline">按 + 唤起</span>
        </button>
      ) : (
        <form
          key={state && "ok" in state ? state.revision : "new-task"}
          action={formAction}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) setOpen(false);
          }}
          className="ac-card space-y-3 p-3"
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

          <details className="group rounded-lg bg-sunken px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-medium text-ink-soft">
              更多设置 <span className="text-ink-faint group-open:hidden">· 负责人、日期、优先级</span>
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
      )}
    </div>
  );
}
