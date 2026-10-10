"use client";

import { useActionState, useId, useRef } from "react";
import { deleteProjectAction } from "../actions";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [state, action, pending] = useActionState(deleteProjectAction, null);
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  return <>
    <button ref={trigger} type="button" className="ac-btn-ghost text-xs text-risk" aria-label={`删除项目：${projectName}`} onClick={() => dialog.current?.showModal()}>删除项目</button>
    <dialog ref={dialog} aria-labelledby={titleId} className="ac-project-delete-dialog" onCancel={event => { event.preventDefault(); if (!pending) close(); }}>
      <h2 id={titleId} className="text-xl font-semibold text-ink">确认删除项目？</h2>
      <p className="mt-4 text-sm text-ink">{projectName}</p>
      <p className="mt-3 text-sm leading-7 text-ink-2">删除后，项目及其任务、草案、里程碑和项目内的协作记录会被清除，无法撤销。团队和成员账号会保留。</p>
      <form action={action} className="mt-6">
        <input type="hidden" name="projectId" value={projectId} />
        {state?.error && <p role="alert" className="mb-4 text-sm text-risk">{state.error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" autoFocus disabled={pending} className="ac-btn-ghost" onClick={close}>取消</button>
          <button type="submit" disabled={pending} className="ac-btn bg-risk text-white">{pending ? "正在删除…" : "确认删除项目"}</button>
        </div>
      </form>
    </dialog>
  </>;
}
