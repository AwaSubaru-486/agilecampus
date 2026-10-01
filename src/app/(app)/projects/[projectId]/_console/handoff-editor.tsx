"use client";

/**
 * 交接表单（W04）。
 *
 * 允许有写权限的用户编辑：接手人、handoffBrief、doneCriteria、
 * requiredEvidence、responseDueAt、contextPackId。
 * 保存只调用已有 updateTask 权限和契约逻辑；不直接写 DB。
 *
 * 当前版本：只读展示 + 跳转网页编辑入口（W04 完整表单待服务端 action 就位后接入）。
 */

import Link from "next/link";
import type { SelectedTaskDetail } from "./console-shell";

export function HandoffEditor({
  projectId,
  selectedTask,
  canWrite,
}: {
  projectId: string;
  selectedTask: SelectedTaskDetail;
  canWrite: boolean;
}) {
  if (!canWrite) {
    return (
      <p className="text-sm text-ink-3">你没有编辑此任务交接信息的权限。</p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        交接表单（W04）：完整编辑能力在当前阶段通过任务详情页实现。
      </p>
      <Link
        href={`/projects/${projectId}?space=work&task=${selectedTask.id}&edit=1`}
        className="inline-block rounded border border-stroke px-3 py-1.5 text-sm text-ink hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        在任务页编辑交接信息
      </Link>
    </div>
  );
}
