"use client";

import React, { useState, useActionState } from "react";
import { deleteProjectAction, type FormState } from "../actions";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      try {
        const res = await deleteProjectAction(prev, fd);
        return res;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "删除失败";
        return { error: msg };
      }
    },
    null,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-50/60 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        title="仅团队组长可删除此项目"
      >
        <span>🗑️ 删除项目</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-fade-in"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-stroke bg-panel p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-stroke pb-3">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-red-100 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                  ⚠️
                </span>
                <h3 className="text-base font-bold text-ink">确认彻底删除项目</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-ink-2">
              <p>
                您正准备删除项目：
                <strong className="text-ink font-semibold ml-1">「{projectName}」</strong>
              </p>
              <div className="rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900">
                <span className="font-bold">⚠️ 不可逆操作提醒：</span>
                <p className="mt-1">
                  删除后，此项目的所有敏捷任务卡片、成员分配、工作流记录、里程碑排期及归档成果物将全数清除，无法撤销与找回。
                </p>
              </div>
            </div>

            <form action={formAction} className="space-y-4 pt-1">
              <input type="hidden" name="projectId" value={projectId} />

              {state && "error" in state && (
                <p className="text-xs text-risk bg-risk/10 p-2 rounded">
                  ⚠️ {state.error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stroke">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="ac-btn-ghost text-xs px-3 py-1.5"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {pending ? "正在删除…" : "确认彻底删除项目"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
