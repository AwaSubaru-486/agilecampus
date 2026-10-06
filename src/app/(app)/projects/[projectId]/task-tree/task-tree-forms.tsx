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
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`text-xs ${state.error ? "text-danger" : "text-done"}`}
    >
      {state.error ?? state.success}
    </p>
  );
}

export function DeliveryForm({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const [state, action, pending] = useActionState(submitDeliveryAction, null);
  return (
    <form
      action={action}
      className="mt-2 grid gap-2 border-l-2 border-stroke pl-3 md:grid-cols-2"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <label className="text-xs text-ink-soft">
        任务分支
        <input
          className="ac-input mt-1 w-full"
          name="branchName"
          required
          placeholder="task/login"
        />
      </label>
      <label className="text-xs text-ink-soft">
        提交 SHA（可选）
        <input
          className="ac-input mt-1 w-full"
          name="headSha"
          placeholder="提交标识"
        />
      </label>
      <label className="text-xs text-ink-soft">
        PR 地址（可选）
        <input
          className="ac-input mt-1 w-full"
          name="pullRequestUrl"
          type="url"
          placeholder="https://github.com/…"
        />
      </label>
      <label className="text-xs text-ink-soft">
        测试摘要（可选）
        <input
          className="ac-input mt-1 w-full"
          name="testSummary"
          placeholder="验证了哪些行为"
        />
      </label>
      <div className="flex items-center justify-between gap-2 md:col-span-2">
        <Result state={state} />
        <button className="ac-btn-ghost" disabled={pending}>
          {pending ? "登记中..." : "登记交付分支"}
        </button>
      </div>
    </form>
  );
}

export function BriefForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(generateTreeAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="block text-xs text-ink-soft">
        项目说明
        <textarea
          name="content"
          required
          minLength={10}
          maxLength={20000}
          rows={7}
          className="ac-input mt-2 w-full resize-y"
          placeholder="说明项目目标、交付要求、需求变化和补充约束（至少 10 字）"
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <Result state={state} />
        <button type="submit" disabled={pending} className="ac-btn">
          {pending ? "正在生成..." : "AI 生成任务树草案"}
        </button>
      </div>
    </form>
  );
}

export function DraftActions({
  projectId,
  draftId,
  disabled = false,
}: {
  projectId: string;
  draftId: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(resolveDraftAction, null);
  return (
    <form
      action={action}
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="draftId" value={draftId} />
      <Result state={state} />
      <button
        name="decision"
        value="reject"
        disabled={pending}
        className="ac-btn-ghost"
      >
        撤销
      </button>
      <button
        name="decision"
        value="publish"
        disabled={pending || disabled}
        className="ac-btn"
      >
        确认并发布
      </button>
    </form>
  );
}

export function IntegrationSubmitForm({
  projectId,
  stageId,
}: {
  projectId: string;
  stageId: string;
}) {
  const [state, action, pending] = useActionState(
    submitIntegrationAction,
    null,
  );
  return (
    <form
      action={action}
      className="grid gap-2 border-t border-stroke pt-3 md:grid-cols-2"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="stageId" value={stageId} />
      <label className="text-xs text-ink-soft">
        集成分支
        <input
          className="ac-input mt-1 w-full"
          name="branchName"
          required
          placeholder="integration/stage-1"
        />
      </label>
      <label className="text-xs text-ink-soft">
        提交 SHA（可选）
        <input className="ac-input mt-1 w-full" name="headSha" />
      </label>
      <label className="text-xs text-ink-soft md:col-span-2">
        集成测试结果（可选）
        <textarea
          className="ac-input mt-1 w-full"
          name="testSummary"
          rows={2}
        />
      </label>
      <div className="flex items-center justify-between gap-3 md:col-span-2">
        <Result state={state} />
        <button className="ac-btn" disabled={pending}>
          {pending ? "提交中..." : "提交集成审核"}
        </button>
      </div>
    </form>
  );
}

export function IntegrationReviewForm({
  projectId,
  integrationId,
}: {
  projectId: string;
  integrationId: string;
}) {
  const [state, action, pending] = useActionState(
    reviewIntegrationAction,
    null,
  );
  return (
    <form action={action} className="space-y-2 border-t border-stroke pt-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="integrationId" value={integrationId} />
      <label className="block text-xs text-ink-soft">
        审核意见（退回时必填）
        <input className="ac-input mt-1 w-full" name="note" />
      </label>
      <div className="flex items-center justify-end gap-2">
        <Result state={state} />
        <button
          name="decision"
          value="reject"
          className="ac-btn-ghost"
          disabled={pending}
        >
          退回
        </button>
        <button
          name="decision"
          value="accept"
          className="ac-btn"
          disabled={pending}
        >
          通过并解锁下一阶段
        </button>
      </div>
    </form>
  );
}
