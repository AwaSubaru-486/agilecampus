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
    <section id="ai-collaboration" aria-busy={pending || loadingConversation} className="scroll-mt-20 overflow-hidden border-y border-line">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-agent">协同室</p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink">把问题交给团队一起推进</h2>
            <p className="mt-1 text-xs text-ink-faint">
              每次讨论都关联项目与任务；从关键回复分叉，不覆盖原来的思路
            </p>
          </div>
          <button type="button" onClick={() => setCreating((value) => !value)} className="ac-btn-ink ac-pressable px-3 py-2 text-sm">
            {creating ? "取消" : "+ 新会话"}
          </button>
        </div>
        {creating && (
          <div className="ac-panel-enter mt-3 grid gap-2 border-l-2 border-agent bg-agent-soft/35 p-3 md:grid-cols-[1fr_11rem_9rem_auto]">
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

      <div className="grid min-h-[26rem] md:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_15rem]">
        <aside className="border-b border-line bg-ground p-2.5 md:border-b-0 md:border-r">
          <p className="px-2 py-1.5 text-xs font-medium text-ink-3">会话</p>
          <div className="max-h-[28rem] space-y-1 overflow-y-auto">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => refreshConversation(conversation.id)}
                  className={`ac-pressable min-h-11 w-full border-l-2 px-2.5 py-2 text-left ${
                  conversation.id === conversationId ? "border-ink bg-surface" : "border-transparent hover:border-stroke-strong hover:bg-surface/70"
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
                <span className="border border-line bg-sunken px-1.5 py-0.5">
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

          <div className="max-h-[24rem] flex-1 space-y-3 overflow-y-auto p-4">
            {loadingConversation && <p role="status" className="text-center text-sm text-ink-faint">正在加载会话…</p>}
            {!loadingConversation && messages.map((message) => (
              <div key={message.id}>
                <div className={`border-l-2 px-3.5 py-2.5 text-sm ${message.role === "user" ? "ml-8 border-stroke bg-sunken/60" : "mr-8 border-agent/40 bg-agent-soft/40"}`}>
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
                      className="ac-pressable mt-2 min-h-9 text-xs text-primary hover:underline disabled:opacity-50"
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
              <div className="border-y border-line py-8">
                <p className="text-sm font-medium text-ink">先定义这次协作要改变什么</p>
                <p className="mt-2 max-w-md text-xs leading-5 text-ink-2">把问题、约束和期望的交付写清楚。AI 的回复会留在当前会话，之后可以分支比较或提交待确认动作。</p>
                <div className="mt-5 grid gap-2 text-xs text-ink-3 sm:grid-cols-3">
                  <span className="border-l-2 border-agent pl-2">说明现状</span>
                  <span className="border-l-2 border-signal pl-2">提出方案</span>
                  <span className="border-l-2 border-human pl-2">人工确认</span>
                </div>
              </div>
            )}
          </div>

          {error && <p role="alert" className="px-4 pb-2 text-sm text-high">{error}</p>}
          <div className="flex gap-2 border-t border-line p-3">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && send()}
              placeholder={conversationId ? "继续这个会话…" : "先创建或直接开始一个会话…"}
              className="ac-field flex-1 text-sm"
              disabled={pending}
            />
            <button type="button" onClick={send} disabled={pending || !input.trim()} className="ac-btn-ink ac-pressable px-4 py-2 text-sm">
              {pending ? "处理中…" : "发送"}
            </button>
          </div>
        </div>

        <aside className="hidden border-l border-line bg-ground px-3 py-4 xl:block">
          <p className="text-[11px] font-medium tracking-[0.08em] text-ink-faint">本次协作</p>
          {initialTask ? (
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-[11px] text-ink-faint">关联任务</p>
                <p className="mt-1 text-sm font-medium leading-5 text-ink">{initialTask.name}</p>
              </div>
              <div className="border-t border-line pt-3">
                <label className="text-[11px] text-ink-faint" htmlFor="context-pack">
                  发送时使用的冻结上下文
                </label>
                <select
                  id="context-pack"
                  value={contextPackId ?? ""}
                  onChange={(event) => setContextPackId(event.target.value || null)}
                  className="ac-field mt-2 text-xs"
                >
                  <option value="">仅使用会话与项目快照</option>
                  {initialContextPacks
                    .filter((pack) => pack.status === "frozen")
                    .map((pack) => (
                      <option key={pack.id} value={pack.id}>{pack.title}</option>
                    ))}
                </select>
                <p className="mt-2 text-[11px] leading-5 text-ink-2">
                  {initialContextPacks.some((pack) => pack.status === "frozen")
                    ? "模型只会读取冻结包里的明确来源；来源变化后会标记过期。"
                    : "还没有冻结包。先用 API 预览并确认项目事实，再交给模型。"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs leading-5 text-ink-2">从任务进入协同室，会自动带上任务上下文；也可以先创建一个项目级会话。</p>
          )}
          <div className="mt-8 border-t border-line pt-3">
            <p className="text-[11px] text-ink-faint">人工边界</p>
            <p className="mt-1 text-xs leading-5 text-ink-2">AI 只提出建议。创建任务、修改字段和验收结果，都需要成员明确确认。</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
