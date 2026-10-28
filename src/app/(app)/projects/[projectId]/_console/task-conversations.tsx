"use client";

import Link from "next/link";

export type ConversationRef = { id: string; title?: string | null; updatedAt?: string | null };

export function TaskConversations({ projectId, taskId, conversations }: { projectId: string; taskId: string; conversations: ConversationRef[] }) {
  const base = `/projects/${projectId}?space=studio&view=chat&task=${taskId}`;
  return <div>
    {conversations.length ? <>
      <div className="divide-y divide-stroke">{conversations.slice(0, 3).map((conversation) => <Link
        key={conversation.id} href={`${base}&conversation=${conversation.id}`}
        className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-ink hover:underline focus-visible:ring-2 focus-visible:ring-signal">
        <span className="truncate">{conversation.title || "任务对话"}</span>
        {conversation.updatedAt && <time className="shrink-0 text-xs text-ink-2">{new Date(conversation.updatedAt).toLocaleDateString("zh-CN")}</time>}
      </Link>)}</div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs"><Link className="min-h-9 content-center text-ink-2 underline underline-offset-4" href={base}>查看全部对话</Link><Link className="min-h-9 content-center text-ink-2 underline underline-offset-4" href={`${base}&new=1`}>新建任务对话</Link></div>
    </> : <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-ink-2">暂无任务对话</span><Link className="ac-btn-ghost !min-h-9 !text-xs" href={`${base}&new=1`}>开始任务对话</Link></div>}
  </div>;
}
