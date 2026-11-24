"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { submitTaskAction } from "../actions";
import { LoadingProgress } from "@/components/loading-progress";
import { RequiredEvidenceFields } from "./required-evidence-fields";
import type { EvidenceType } from "@/lib/handoff";

export type SubmissionTask = { id: string; title: string; description?: string | null; doneCriteria?: string[] | null; assigneeName?: string | null; handoffVersion?: number | null };

export function TaskSubmissionForm({ projectId, task, evidenceTypes = [], onSubmitted }: { projectId: string; task: SubmissionTask; evidenceTypes?: EvidenceType[]; onSubmitted?: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitTaskAction, null);
  const onSubmittedRef = useRef(onSubmitted);
  useEffect(() => { onSubmittedRef.current = onSubmitted; }, [onSubmitted]);
  useEffect(() => {
    if (state?.ok) { onSubmittedRef.current?.(); router.refresh(); }
  }, [state, router]);
  return <form action={action} className="space-y-4" aria-busy={pending}>
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="taskId" value={task.id} />
    <input type="hidden" name="handoffVersion" value={task.handoffVersion ?? 1} />
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm text-ink-2">任务分支<span className="ml-1 text-risk">*</span><input name="branchName" required maxLength={200} className="ac-field mt-2" placeholder="task/login" disabled={pending} /></label>
      <label className="block text-sm text-ink-2">提交 SHA（可选）<input name="headSha" maxLength={128} className="ac-field mt-2" placeholder="提交标识" disabled={pending} /></label>
      <label className="block text-sm text-ink-2">PR 地址（可选）<input name="pullRequestUrl" type="url" maxLength={2000} className="ac-field mt-2" placeholder="https://github.com/…" disabled={pending} /></label>
      <label className="block text-sm text-ink-2">测试摘要（可选）<textarea name="testSummary" maxLength={5000} rows={2} className="ac-field mt-2" placeholder="验证了哪些行为" disabled={pending} /></label>
    </div>
    {evidenceTypes.length > 0 && <section className="space-y-3"><h4 className="text-sm font-semibold">必需交付证据</h4><RequiredEvidenceFields types={evidenceTypes} /></section>}
    {state?.error && <p role="alert" className="text-sm text-risk">{state.error}</p>}
    {pending && <LoadingProgress label="正在提交交付材料…" />}
    <button type="submit" className="ac-btn" disabled={pending}>{pending ? "提交中…" : "提交给组长审核"}</button>
  </form>;
}

export function TaskSubmitDialog({ projectId, task, evidenceTypes = [] }: { projectId: string; task: SubmissionTask; evidenceTypes?: EvidenceType[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <div onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button type="button" data-tour="task-submit" className="ac-btn" onClick={() => dialog.current?.showModal()}>提交任务</button>
    <dialog ref={dialog} aria-label={`提交任务：${task.title}`} className="ac-task-dialog" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-stroke bg-panel p-5"><div><p className="text-xs text-ink-3">提交后等待组长审核</p><h3 className="mt-2 text-lg font-semibold">{task.title}</h3></div><button type="button" className="ac-btn-ghost" aria-label="关闭提交窗口" onClick={() => dialog.current?.close()}>关闭 ×</button></header>
      <div className="space-y-5 p-5" data-tour="submission-dialog"><p className="text-sm text-ink-3">负责人：{task.assigneeName ?? "未分配"}</p>
        <section><h4 className="text-sm font-semibold">任务目标</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{task.description || "按任务完成条件交付成果。"}</p></section>
        {!!task.doneCriteria?.length && <section><h4 className="text-sm font-semibold">完成条件</h4><ul className="mt-2 space-y-2 text-sm">{task.doneCriteria.map((text, index) => <li key={index}>□ {text}</li>)}</ul></section>}
        <section className="space-y-3"><h4 className="text-sm font-semibold text-signal">交付材料</h4><TaskSubmissionForm key={`${task.id}:${task.handoffVersion}`} projectId={projectId} task={task} evidenceTypes={evidenceTypes} onSubmitted={() => dialog.current?.close()} /></section>
      </div>
    </dialog>
  </div>;
}
