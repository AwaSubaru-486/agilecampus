"use client";

import { useMemo, useState } from "react";
import { buildConversationTree } from "@/lib/conversation-tree";

type Conversation = {
  id: string;
  title: string | null;
  visibility: "private" | "project";
  taskTitle: string | null;
  parentConversationId: string | null;
  createdById: string;
  createdByName: string;
  updatedAt: string;
};

export function ConversationTree({
  conversations,
  selectedId,
  currentUserId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  currentUserId: string;
  onSelect: (conversationId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(
    () =>
      buildConversationTree(conversations, {
        getId: (item) => item.id,
        getParentId: (item) => item.parentConversationId,
        isCollapsed: (id) => collapsed.has(id),
      }),
    [collapsed, conversations],
  );

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div role="tree" aria-label="协作会话树" className="max-h-[28rem] overflow-y-auto">
      {tree.map((node) => {
        const conversation = node.item;
        const isSelected = conversation.id === selectedId;
        const hasChildren = node.childCount > 0;
        return (
          <div key={conversation.id} role="treeitem" aria-level={node.depth + 1} aria-selected={isSelected}>
            <div className="flex items-stretch" style={{ paddingLeft: `${node.depth * 14}px` }}>
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={node.expanded ? "收起分支" : "展开分支"}
                  aria-expanded={node.expanded}
                  onClick={() => toggle(conversation.id)}
                  className="grid w-6 shrink-0 place-items-center text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal"
                >
                  <span aria-hidden className={node.expanded ? "ac-icon-chevron-down" : "ac-icon-chevron-right"} />
                </button>
              ) : (
                <span aria-hidden className="w-6 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                className={`ac-pressable min-h-11 min-w-0 flex-1 border-l-2 px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-signal ${
                  isSelected
                    ? "border-ink bg-panel"
                    : "border-transparent hover:border-stroke-strong hover:bg-panel/70"
                }`}
              >
                <span className="block truncate text-sm font-medium text-ink">
                  {conversation.title || "未命名会话"}
                </span>
                <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-ink-3">
                  <span>{conversation.createdById === currentUserId ? "我" : conversation.createdByName}</span>
                  <span aria-hidden>·</span>
                  <span>{conversation.visibility === "project" ? "共享" : "私人"}</span>
                  {node.depth > 0 && <span>· 分支</span>}
                </span>
                {conversation.taskTitle && (
                  <span className="mt-1 block truncate text-[11px] text-ink-2">任务：{conversation.taskTitle}</span>
                )}
              </button>
            </div>
          </div>
        );
      })}
      {tree.length === 0 && <p className="px-2 py-6 text-center text-xs text-ink-3">还没有 AI 会话</p>}
    </div>
  );
}
