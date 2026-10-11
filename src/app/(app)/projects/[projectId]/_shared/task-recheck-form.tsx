"use client";
import { useActionState } from "react";
import { recheckCompletedTaskAction } from "../actions";

export function TaskRecheckForm({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [state, action, pending] = useActionState(recheckCompletedTaskAction, null);
  return <form action={action} className="space-y-3 border border-stroke bg-panel p-4">
    <h3 className="font-semibold text-ink">老师复核</h3><p className="text-xs leading-6 text-ink-3">对已完成成果给出复核意见，意见保存在任务与成果记录中。</p>
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="taskId" value={taskId} />
    <label className="block text-sm">复核意见<textarea name="note" aria-label="复核意见" maxLength={5000} className="ac-field mt-2 min-h-24" placeholder="写下检查结果，需要修改时请说明具体内容" /></label>
    <div className="flex gap-3"><button type="submit" name="decision" value="accept" disabled={pending} className="ac-btn">复核通过</button><button type="submit" name="decision" value="revise" disabled={pending} className="ac-btn-ghost">需修改</button></div>
    {state && "error" in state && <p role="alert" className="text-sm text-risk">{state.error}</p>}{state && "ok" in state && <p role="status" className="text-sm text-signal">复核意见已保存。</p>}
  </form>;
}
