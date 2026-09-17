"use client";

import { useEffect, useMemo, useState } from "react";
import { DraftCards, type Draft } from "./draft-cards";

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

export function ChatPanel({
  projectId,
  currentUserId,
  initialConversations,
  initialConversationId,
  initialMessages,
  members,
  milestones,
  tasks,
}: {
  projectId: string;
  currentUserId: string;
  initialConversations: Conversation[];
  initialConversationId: string | null;
  initialMessages: Msg[];
  members: Option[];
  milestones: Option[];
  tasks: Option[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newVisibility, setNewVisibility] = useState<"private" | "project">("project");
  const [newTaskId, setNewTaskId] = useState("");
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ projectId, conversationId: conversationId ?? undefined, userText: text }),
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
    <section id="ai-collaboration" className="ac-card scroll-mt-20 overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-ink">AI 协作空间</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              团队共享会话、继承上下文，并从任意 AI 回复探索新的方案分支
            </p>
          </div>
          <button type="button" onClick={() => setCreating((value) => !value)} className="ac-btn px-3 py-2 text-sm">
            {creating ? "取消" : "+ 新会话"}
          </button>
        </div>
        {creating && (
          <div className="mt-3 grid gap-2 rounded-lg bg-sunken p-3 md:grid-cols-[1fr_11rem_9rem_auto]">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="会话主题，如 用户访谈方案"
              className="ac-field text-sm"
            />
            <select value={newTaskId} onChange={(event) => setNewTaskId(event.target.value)} className="ac-field text-sm">
              <option value="">不关联任务</option>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
            </select>
            <select
              value={newVisibility}
              onChange={(event) => setNewVisibility(event.target.value as "private" | "project")}
              className="ac-field text-sm"
            >
              <option value="project">项目成员可见</option>
              <option value="private">仅自己可见</option>
            </select>
            <button type="button" onClick={createSession} disabled={pending} className="ac-btn px-3 text-sm">
              创建
            </button>
          </div>
        )}
      </div>

      <div className="grid min-h-[30rem] md:grid-cols-[15rem_1fr]">
        <aside className="border-b border-line bg-sunken/60 p-2 md:border-b-0 md:border-r">
          <p className="px-2 py-1 text-xs font-medium text-ink-faint">项目会话</p>
          <div className="max-h-[28rem] space-y-1 overflow-y-auto">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => refreshConversation(conversation.id)}
                className={`w-full rounded-lg px-2.5 py-2 text-left transition ${
                  conversation.id === conversationId ? "bg-primary-soft" : "hover:bg-canvas"
                }`}
              >
                <span className="block truncate text-sm font-medium text-ink">
                  {conversation.title || "未命名会话"}
                </span>
                <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-ink-faint">
                  <span>{conversation.createdById === currentUserId ? "我" : conversation.createdByName}</span>
                  <span>·</span>
                  <span>{conversation.visibility === "project" ? "项目共享" : "私人"}</span>
                  {conversation.parentConversationId && <span>· 分支</span>}
                </span>
                {conversation.taskTitle && (
                  <span className="mt-1 block truncate text-[11px] text-ink-soft">任务：{conversation.taskTitle}</span>
                )}
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-ink-faint">还没有 AI 会话</p>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <div className="border-b border-line px-4 py-2.5">
            {activeConversation ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span className="font-medium text-ink">{activeConversation.title}</span>
                <span className="rounded-full bg-sunken px-2 py-0.5">
                  {activeConversation.visibility === "project" ? "项目成员可见" : "仅自己可见"}
                </span>
                {activeConversation.parentConversationId && (
                  <button
                    type="button"
                    onClick={() => refreshConversation(activeConversation.parentConversationId!)}
                    className="text-primary hover:underline"
                  >
                    查看来源会话
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-faint">创建会话后开始与 AI 协作</p>
            )}
          </div>

          <div className="max-h-[26rem] flex-1 space-y-3 overflow-y-auto p-4">
            {loadingConversation && <p className="text-center text-sm text-ink-faint">正在加载会话…</p>}
            {!loadingConversation && messages.map((message) => (
              <div key={message.id}>
                <div className={`rounded-lg p-3 text-sm ${message.role === "user" ? "bg-sunken" : "bg-primary-soft"}`}>
                  <div className="mb-1 flex items-center gap-2 text-xs text-ink-faint">
                    <span>{message.role === "user" ? message.authorName || "成员" : "AI 助手"}</span>
                    {message.sourceMessageId && <span className="rounded bg-canvas/70 px-1.5 py-0.5">继承内容</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-ink">{message.content}</p>
                  {message.role === "assistant" && !message.id.startsWith("pending-") && (
                    <button
                      type="button"
                      onClick={() => forkFrom(message)}
                      disabled={pending}
                      className="mt-2 text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      从这里创建方案分支
                    </button>
                  )}
                </div>
                {message.drafts && message.drafts.length > 0 && (
                  <DraftCards projectId={projectId} drafts={message.drafts} members={members} milestones={milestones} />
                )}
              </div>
            ))}
            {!loadingConversation && messages.length === 0 && (
              <div className="py-14 text-center">
                <p className="text-sm text-ink-soft">向 AI 说明这个会话要解决的问题</p>
                <p className="mt-1 text-xs text-ink-faint">例如：根据课程截止时间，帮我们拆解用户调研计划</p>
              </div>
            )}
          </div>

          {error && <p className="px-4 pb-2 text-sm text-high">{error}</p>}
          <div className="flex gap-2 border-t border-line p-3">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && send()}
              placeholder={conversationId ? "继续这个会话…" : "先创建或直接开始一个会话…"}
              className="ac-field flex-1 text-sm"
              disabled={pending}
            />
            <button type="button" onClick={send} disabled={pending} className="ac-btn px-4 py-2 text-sm">
              {pending ? "处理中…" : "发送"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
