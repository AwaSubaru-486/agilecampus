"use client";

import React, { useState, useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KIND_LABEL, KIND_ACTION, type RawAction } from "@/lib/action-queue";
import {
  claimTaskAction,
  reviewTaskAction,
  type FormState,
} from "../projects/[projectId]/actions";

const TONE: Record<string, string> = {
  assignment_response: "bg-warn-soft text-warn",
  approval_review: "bg-signal-soft text-signal",
  decision_review: "bg-signal-soft text-signal",
  review: "bg-agent-soft text-agent",
  blocker_invite: "bg-risk-soft text-risk",
  rejected_work: "bg-risk-soft text-risk",
  overdue: "bg-risk-soft text-risk",
  due_soon: "bg-warn-soft text-warn",
};

export function TodayActionRow({ action: a }: { action: RawAction }) {
  const router = useRouter();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const href = a.approvalId
    ? `/projects/${a.projectId}?space=studio&approval=${a.approvalId}`
    : a.decisionId
    ? `/projects/${a.projectId}?space=record#decisions`
    : a.taskId
    ? `/projects/${a.projectId}?space=work&task=${a.taskId}`
    : `/projects/${a.projectId}?space=live`;

  // 待验收：支持一键快速通过
  const [reviewState, runReview, reviewing] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      setSuccessMsg(null);
      try {
        const res = await reviewTaskAction(prev, fd);
        if (!res || !("error" in res)) {
          setSuccessMsg("✓ 已通过验收");
          router.refresh();
          return null;
        }
        return res;
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "验收失败" };
      }
    },
    null,
  );

  // 待回应：支持一键快速接住
  const [claimState, runClaim, claiming] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      setSuccessMsg(null);
      try {
        const res = await claimTaskAction(prev, fd);
        if (!res || !("error" in res)) {
          setSuccessMsg("✓ 已成功接住");
          router.refresh();
          return null;
        }
        return res;
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "接住失败" };
      }
    },
    null,
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-sunken/60">
      <Link
        href={href}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        <span className={`ac-badge ${TONE[a.kind] ?? "bg-sunken text-ink-3"}`}>
          {KIND_LABEL[a.kind] ?? a.kind}
        </span>
        <span className="text-sm font-medium text-ink hover:text-signal hover:underline">
          {a.title}
        </span>
        <span className="text-xs text-ink-3">{a.projectName}</span>
        {a.context && (
          <span className="w-full text-xs text-ink-3 sm:w-auto">{a.context}</span>
        )}
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        {successMsg && (
          <span className="text-xs font-semibold text-success animate-fade-in">
            {successMsg}
          </span>
        )}

        {reviewState && "error" in reviewState && (
          <span className="text-xs text-risk">{reviewState.error}</span>
        )}
        {claimState && "error" in claimState && (
          <span className="text-xs text-risk">{claimState.error}</span>
        )}

        {/* 待验收模式：提供快速一键「通过」按钮与「退回/详情」入口 */}
        {a.kind === "review" && a.taskId ? (
          <div className="flex items-center gap-2">
            <form
              action={runReview}
              className="inline-block"
              onSubmit={(e) => e.stopPropagation()}
            >
              <input type="hidden" name="projectId" value={a.projectId} />
              <input type="hidden" name="taskId" value={a.taskId} />
              <input type="hidden" name="decision" value="accept" />
              <input type="hidden" name="note" value="验收通过" />
              <button
                type="submit"
                disabled={reviewing}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
                title="一键验收通过此任务"
              >
                {reviewing ? "通过中…" : "✓ 通过"}
              </button>
            </form>
            <Link
              href={href}
              className="text-xs text-ink-3 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal px-1"
              title="前往任务现场退回修改或填写评语"
            >
              退回 / 详情 →
            </Link>
          </div>
        ) : a.kind === "assignment_response" && a.taskId ? (
          /* 待回应模式：提供快速一键「接住」按钮与「接不住/详情」入口 */
          <div className="flex items-center gap-2">
            <form
              action={runClaim}
              className="inline-block"
              onSubmit={(e) => e.stopPropagation()}
            >
              <input type="hidden" name="projectId" value={a.projectId} />
              <input type="hidden" name="taskId" value={a.taskId} />
              <input type="hidden" name="commitmentNote" value="已确认接住并认领任务" />
              <button
                type="submit"
                disabled={claiming}
                className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1 text-xs font-semibold text-white dark:bg-white dark:text-ink shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal cursor-pointer"
                title="一键接住并开始推进此任务"
              >
                {claiming ? "接手中…" : "⚡ 接住"}
              </button>
            </form>
            <Link
              href={href}
              className="text-xs text-ink-3 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal px-1"
              title="前往任务现场说明接不住原因或查看详情"
            >
              接不住 / 详情 →
            </Link>
          </div>
        ) : (
          /* 其余类型（如搭手求助、AI审批、决策确认等）：直达跳转链接 */
          <Link
            href={href}
            className="text-xs font-medium text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {KIND_ACTION[a.kind]} →
          </Link>
        )}
      </div>
    </div>
  );
}
