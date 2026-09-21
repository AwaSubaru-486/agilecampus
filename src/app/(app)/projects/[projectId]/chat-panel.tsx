"use client";

import { useEffect, useMemo, useState } from "react";
import { DraftCards, type Draft } from "./draft-cards";
import { ConversationTree } from "./conversation-tree";
import { ContextPackBuilder } from "./context-pack-builder";
import { ApprovalDetail } from "./approval-detail";
import type { ApprovalListItem } from "@/lib/approval";

type Option = { id: string; name: string };
type Conversation = {
  id: string;
  title: string | null;
  visibility: "private" | "project";
  taskId: string | null;
  taskTitle: string | null;
  parentConversationId: string | null;
  forkedFromMessageId: string | null;
  createdById: string;
  createdByName: string;
  updatedAt: string;
};
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  authorName?: string | null;
  sourceMessageId?: string | null;
  drafts?: Draft[];
};
type ContextPack = {
  id: string;
  title: string;
  status: "draft" | "frozen" | "superseded";
  summary: string | null;
  frozenAt: string | null;
};

export function ChatPanel({
  projectId,
  currentUserId,
  initialConversations,
  initialConversationId,
  initialMessages,
  members,
  milestones,
  tasks,
  initialTaskId,
  initialContextPacks,
  initialApproval,
}: {
  projectId: string;
  currentUserId: string;
  initialConversations: Conversation[];
  initialConversationId: string | null;
  initialMessages: Msg[];
  members: Option[];
  milestones: Option[];
  tasks: Option[];
  initialTaskId?: string | null;
  initialContextPacks: ContextPack[];
  initialApproval: ApprovalListItem | null;
}) {
  const initialTask = initialTaskId ? tasks.find((item) => item.id === initialTaskId) ?? null : null;
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [creating, setCreating] = useState(Boolean(initialTask));
  const [newTitle, setNewTitle] = useState(initialTask ? `任务：${initialTask.name}` : "");
  const [newVisibility, setNewVisibility] = useState<"private" | "project">("project");
  const [newTaskId, setNewTaskId] = useState(initialTask?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [contextPackId, setContextPackId] = useState<string | null>(
    initialContextPacks.find((pack) => pack.status === "frozen")?.id ?? null,
  );
  const [contextPacks, setContextPacks] = useState(initialContextPacks);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? null,
    [conversations, conversationId],
  );

  useEffect(() => {
    function startTaskConversation(event: Event) {
      const detail = (event as CustomEvent<{ taskId: string; title: string }>).detail;
      if (!detail?.taskId) return;
      setNewTaskId(detail.taskId);
      setNewTitle(`任务：${detail.title}`);
      setNewVisibility("project");
      setCreating(true);
      setError(null);
    }
    window.addEventListener("agilecampus:ask-ai", startTaskConversation);
    return () => window.removeEventListener("agilecampus:ask-ai", startTaskConversation);
  }, []);

  async function refreshConversation(id: string) {
    setLoadingConversation(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "加载会话失败");
      setConversationId(id);
      setMessages(
        data.messages
          .filter((message: { role: string }) =>
            message.role === "user" || message.role === "assistant",
          )
          .map((message: Msg) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            authorName: message.authorName,
            sourceMessageId: message.sourceMessageId,
            drafts: message.drafts,
          })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载会话失败");
    } finally {
      setLoadingConversation(false);
    }
  }

  async function createSession() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim() || undefined,
          visibility: newVisibility,
          taskId: newTaskId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "创建会话失败");
      const task = tasks.find((item) => item.id === data.conversation.taskId);
      const created: Conversation = {
        ...data.conversation,
        taskTitle: task?.name ?? null,
        createdByName: "我",
        updatedAt: new Date(data.conversation.updatedAt).toISOString(),
      };
      setConversations((items) => [created, ...items]);
      setConversationId(created.id);
      setMessages([]);
      setCreating(false);
      setNewTitle("");
      setNewTaskId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建会话失败");
    } finally {
      setPending(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setError(null);
    const temporaryId = `pending-${Date.now()}`;
    setMessages((items) => [
      ...items,
      { id: temporaryId, role: "user", content: text, authorName: "我" },
    ]);
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          conversationId: conversationId ?? undefined,
          contextPackId: contextPackId ?? undefined,
          userText: text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "对话失败");

      setConversationId(data.conversationId);
      setMessages((items) => [
        ...items.map((message) =>
          message.id === temporaryId ? { ...message, id: data.userMessageId } : message,
        ),
        {
          id: data.assistantMessageId,
          role: "assistant",
          content: data.text,
          drafts: data.drafts,
        },
      ]);
      if (!conversationId) {
        const listRes = await fetch(`/api/projects/${projectId}/conversations`);
        const listData = await listRes.json();
        if (listRes.ok) {
          setConversations(
            listData.conversations.map((item: Conversation) => ({
              ...item,
              updatedAt: new Date(item.updatedAt).toISOString(),
            })),
          );
        }
      } else {
        setConversations((items) =>
          items.map((item) =>
            item.id === conversationId ? { ...item, updatedAt: new Date().toISOString() } : item,
          ),
        );
      }
    } catch (caught) {
      setMessages((items) => items.filter((message) => message.id !== temporaryId));
      setError(caught instanceof Error ? caught.message : "网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  async function forkFrom(message: Msg) {
    if (!conversationId || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          throughMessageId: message.id,
          visibility: activeConversation?.visibility ?? "project",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "创建分支失败");
      const created: Conversation = {
        ...data.conversation,
        taskTitle: activeConversation?.taskTitle ?? null,
        createdByName: "我",
        updatedAt: new Date(data.conversation.updatedAt).toISOString(),
      };
      setConversations((items) => [created, ...items]);
      await refreshConversation(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建分支失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <section id="ai-collaboration" aria-busy={pending || loadingConversation} className="scroll-mt-20 overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">
      <div className="border-b border-stroke bg-ground/50 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-agent">Agent 协作</p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink">让人和 Agent 一起推进任务</h2>
            <p className="mt-1 text-xs text-ink-3">
              任务、上下文、产物和人工确认都留在同一条推进记录里
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="ac-btn-ink ac-pressable rounded-[var(--radius-control)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {creating ? "取消" : "+ 新会话"}
          </button>
        </div>
        {creating && (
          <div className="ac-panel-enter mt-3 grid gap-2 rounded-[var(--radius-control)] border-l-2 border-agent bg-agent-soft/40 p-3 md:grid-cols-[1fr_11rem_9rem_auto]">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="会话主题，如 用户访谈方案"
              className="ac-field text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
            <select
              value={newTaskId}
              onChange={(event) => setNewTaskId(event.target.value)}
              className="ac-field text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              <option value="">不关联任务</option>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
            </select>
            <select
              value={newVisibility}
              onChange={(event) => setNewVisibility(event.target.value as "private" | "project")}
              className="ac-field text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              <option value="project">项目成员可见</option>
              <option value="private">仅自己可见</option>
            </select>
            <button
              type="button"
              onClick={createSession}
              disabled={pending}
              className="ac-btn rounded-[var(--radius-control)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              创建
            </button>
          </div>
        )}
      </div>

      <div className="grid min-h-[26rem] md:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_15rem]">
        <aside className="border-b border-stroke bg-ground/50 p-2.5 md:border-b-0 md:border-r">
          <p className="px-2 py-1.5 text-xs font-medium text-ink-3">会话列表</p>
          <ConversationTree
            conversations={conversations}
            selectedId={conversationId}
            currentUserId={currentUserId}
            onSelect={refreshConversation}
          />
        </aside>

        <div className="flex min-w-0 flex-col">
          <div className="border-b border-stroke bg-ground/20 px-4 py-2.5">
            {activeConversation ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <span className="font-semibold text-ink">{activeConversation.title}</span>
                <span className="rounded border border-stroke bg-sunken px-1.5 py-0.5 text-[11px]">
                  {activeConversation.visibility === "project" ? "项目成员可见" : "仅自己可见"}
                </span>
                {activeConversation.parentConversationId && (
                  <button
                    type="button"
                    onClick={() => refreshConversation(activeConversation.parentConversationId!)}
                    className="rounded text-signal hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal"
                  >
                    查看来源会话
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-3">创建 Agent 任务后开始协作</p>
            )}
          </div>

          {initialApproval && (
            <ApprovalDetail projectId={projectId} approval={initialApproval} />
          )}

          <div className="max-h-[24rem] flex-1 space-y-3 overflow-y-auto p-4">
            {loadingConversation && <p role="status" className="text-center text-sm text-ink-3">正在加载会话…</p>}
            {!loadingConversation && messages.map((message) => (
              <div key={message.id}>
                <div className={`border-b border-stroke/80 px-1 pb-4 text-sm ${message.role === "user" ? "pt-2" : "pt-1"}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-ink-3">
                    <span className="font-medium text-ink-2">{message.role === "user" ? message.authorName || "成员" : "AI 助手"}</span>
                    {message.sourceMessageId && <span className="border-l border-stroke-strong pl-2 text-[10px]">来自分支来源</span>}
                  </div>
                  <p className="whitespace-pre-wrap leading-6 text-ink">{message.content}</p>
                  {message.role === "assistant" && !message.id.startsWith("pending-") && (
                    <button
                      type="button"
                      onClick={() => forkFrom(message)}
                      disabled={pending}
                      className="ac-pressable mt-3 min-h-8 text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal disabled:opacity-50"
                    >
                      从这里创建方案分支 →
                    </button>
                  )}
                </div>
                {message.drafts && message.drafts.length > 0 && (
                  <DraftCards projectId={projectId} drafts={message.drafts} members={members} milestones={milestones} />
                )}
              </div>
            ))}
            {!loadingConversation && messages.length === 0 && (
              <div className="rounded-[var(--radius-control)] border border-stroke bg-sunken/30 p-6">
                <p className="text-sm font-semibold text-ink">先定义这次协作要改变什么</p>
                <p className="mt-1.5 max-w-md text-xs leading-5 text-ink-2">把问题、约束和期望的交付写清楚。AI 的回复会留在当前会话，之后可以分支比较或提交待确认动作。</p>
                <div className="mt-4 grid gap-2 text-xs text-ink-3 sm:grid-cols-3">
                  <span className="rounded border-l-2 border-agent bg-panel px-2 py-1">说明现状</span>
                  <span className="rounded border-l-2 border-signal bg-panel px-2 py-1">提出方案</span>
                  <span className="rounded border-l-2 border-human bg-panel px-2 py-1">人工确认</span>
                </div>
              </div>
            )}
          </div>

          {error && <p role="alert" className="px-4 pb-2 text-sm font-medium text-risk">{error}</p>}
          <div className="flex gap-2 border-t border-stroke p-3">
              <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && send()}
              placeholder={conversationId ? "补充约束或询问 Agent 进度…" : "先创建一个 Agent 任务…"}
              className="ac-field flex-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              disabled={pending}
            />
            <button
              type="button"
              onClick={send}
              disabled={pending || !input.trim()}
              className="ac-btn-ink ac-pressable rounded-[var(--radius-control)] px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              {pending ? "处理中…" : "发送"}
            </button>
          </div>
        </div>

        <aside className="hidden border-l border-stroke bg-ground/40 px-3 py-4 xl:block">
          {initialTask && (
            <div className="mb-4 border-b border-stroke pb-3">
              <p className="text-[11px] text-ink-3">关联任务</p>
              <p className="mt-1 text-sm font-medium leading-5 text-ink">{initialTask.name}</p>
            </div>
          )}
          <ContextPackBuilder
            projectId={projectId}
            conversationId={conversationId}
            taskId={initialTask?.id ?? null}
            tasks={tasks}
            milestones={milestones}
            conversations={conversations.map((conversation) => ({
              id: conversation.id,
              name: conversation.title ?? "未命名会话",
              title: conversation.title,
            }))}
            packs={contextPacks}
            selectedPackId={contextPackId}
            onSelectPack={setContextPackId}
            onPacksChange={setContextPacks}
          />
          <div className="mt-8 border-t border-stroke pt-3">
            <p className="text-[11px] font-medium text-ink-3">人工边界</p>
            <p className="mt-1 text-xs leading-5 text-ink-2">AI 只提出建议。创建任务、修改字段和验收结果，都需要成员明确确认。</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
