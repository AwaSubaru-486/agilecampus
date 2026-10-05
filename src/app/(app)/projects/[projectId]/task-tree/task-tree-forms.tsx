"use client";

import { useActionState } from "react";
import {
  generateTreeAction,
  resolveDraftAction,
  reviewIntegrationAction,
  submitIntegrationAction,
  submitDeliveryAction,
  type TreeActionState,
} from "./actions";

function Result({ state }: { state: TreeActionState }) {
  if (!state) return null;
  return <p className={`text-xs ${state.error ? "text-danger" : "text-done"}`}>{state.error ?? state.success}</p>;
}

export function DeliveryForm({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [state, action, pending] = useActionState(submitDeliveryAction, null);
  return (
    <form action={action} className="mt-2 grid gap-2 border-l-2 border-stroke pl-3 md:grid-cols-2">
      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="taskId" value={taskId} />
      <input className="ac-input" name="branchName" required placeholder="任务分支" />
      <input className="ac-input" name="headSha" placeholder="HEAD SHA（可选）" />
      <input className="ac-input" name="pullRequestUrl" placeholder="PR 地址（可选）" />
      <input className="ac-input" name="testSummary" placeholder="测试摘要（可选）" />
      <div className="flex items-center justify-between gap-2 md:col-span-2"><Result state={state} /><button className="ac-btn-ghost" disabled={pending}>{pending ? "登记中..." : "登记交付分支"}</button></div>
    </form>
  );
}

export function BriefForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(generateTreeAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <textarea name="content" required minLength={10} rows={7} className="ac-input w-full resize-y" placeholder="粘贴新的项目说明、需求变化或补充约束" />
      <div className="flex items-center justify-between gap-3">
        <Result state={state} />
        <button type="submit" disabled={pending} className="ac-btn">{pending ? "正在生成..." : "AI 生成任务树草案"}</button>
      </div>
    </form>
  );
}

export function DraftActions({ projectId, draftId }: { projectId: string; draftId: string }) {
  const [state, action, pending] = useActionState(resolveDraftAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="draftId" value={draftId} />
      <Result state={state} />
      <button name="decision" value="reject" disabled={pending} className="ac-btn-ghost">撤销</button>
      <button name="decision" value="publish" disabled={pending} className="ac-btn">确认并发布</button>
    </form>
  );
}

export function IntegrationSubmitForm({ projectId, stageId }: { projectId: string; stageId: string }) {
  const [state, action, pending] = useActionState(submitIntegrationAction, null);
  return (
    <form action={action} className="grid gap-2 border-t border-stroke pt-3 md:grid-cols-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="stageId" value={stageId} />
      <input className="ac-input" name="branchName" required placeholder="集成分支，如 integration/stage-1" />
      <input className="ac-input" name="headSha" placeholder="HEAD SHA（可选）" />
      <textarea className="ac-input md:col-span-2" name="testSummary" rows={2} placeholder="集成测试结果（可选）" />
      <div className="flex items-center justify-between gap-3 md:col-span-2">
        <Result state={state} />
        <button className="ac-btn" disabled={pending}>{pending ? "提交中..." : "提交集成审核"}</button>
      </div>
    </form>
  );
}

export function IntegrationReviewForm({ projectId, integrationId }: { projectId: string; integrationId: string }) {
  const [state, action, pending] = useActionState(reviewIntegrationAction, null);
  return (
    <form action={action} className="space-y-2 border-t border-stroke pt-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="integrationId" value={integrationId} />
      <input className="ac-input w-full" name="note" placeholder="审核意见；退回时必填" />
      <div className="flex items-center justify-end gap-2">
        <Result state={state} />
        <button name="decision" value="reject" className="ac-btn-ghost" disabled={pending}>退回</button>
        <button name="decision" value="accept" className="ac-btn" disabled={pending}>通过并解锁下一阶段</button>
      </div>
    </form>
  );
}
