"use client";

/**
 * 任务会话容器（W06）。
 *
 * 只列当前 taskId 下当前用户可读的会话。
 * 无会话时显示"该任务暂无会话"，不回落其他任务最近会话。
 * 会话分叉使用"从此消息创建会话分支"，不暗示代码已恢复。
 *
 * 当前版本：跳转至 studio 模式查看指定任务会话。
 * 完整会话嵌入（W06）待 chat-panel 解耦后接入。
 */

import Link from "next/link";

export type ConversationRef = {
  id: string;
  title?: string | null;
  updatedAt?: string | null;
};

export function TaskConversations({
  projectId,
  taskId,
  conversations,
}: {
  projectId: string;
  taskId: string;
  conversations: ConversationRef[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-ink-2">会话与分支</h4>
        <div className="flex items-center gap-2 text-xs">
          <Link
            href={`/projects/${projectId}?space=studio&view=chat&task=${taskId}&new=1`}
            className="text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            + 新建会话
          </Link>
          <Link
            href={`/projects/${projectId}?space=studio&view=chat&task=${taskId}`}
            className="text-ink-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            在协同室查看 →
          </Link>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div className="rounded border border-dashed border-stroke p-3 text-center">
          <p className="text-sm text-ink-3">该任务暂无会话</p>
          <Link
            href={`/projects/${projectId}?space=studio&view=chat&task=${taskId}&new=1`}
            className="mt-1.5 inline-block text-xs text-signal hover:underline"
          >
            + 为此任务发起会话
          </Link>
        </div>
      ) : (
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/projects/${projectId}?space=studio&task=${taskId}&conversation=${c.id}`}
                className="flex items-center justify-between gap-2 rounded border border-stroke px-3 py-2 text-sm hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                <span className="truncate text-ink">{c.title ?? "未命名会话"}</span>
                {c.updatedAt && (
                  <span className="shrink-0 text-xs text-ink-3">
                    {new Date(c.updatedAt).toLocaleDateString("zh-CN")}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* 说明：分叉不等于代码恢复 */}
      <p className="text-xs text-ink-3">
        会话分叉在协同室中操作。分叉只保留会话上下文，不代表代码分支或 Agent 已恢复。
      </p>
    </div>
  );
}
