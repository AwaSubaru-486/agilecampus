"use client";

import { useMemo, useState } from "react";

type SourceType = "project" | "task" | "milestone" | "conversation";
type Option = { id: string; name: string };
type ConversationOption = Option & { title: string | null };
type Pack = {
  id: string;
  title: string;
  status: "draft" | "frozen" | "superseded";
  summary: string | null;
  frozenAt: string | null;
};
type PreviewItem = { sourceType: string; label: string; included: boolean; textSize: number };

export function ContextPackBuilder({
  projectId,
  conversationId,
  taskId,
  tasks,
  milestones,
  conversations,
  packs,
  selectedPackId,
  onSelectPack,
  onPacksChange,
}: {
  projectId: string;
  conversationId: string | null;
  taskId: string | null;
  tasks: Option[];
  milestones: Option[];
  conversations: ConversationOption[];
  packs: Pack[];
  selectedPackId: string | null;
  onSelectPack: (id: string | null) => void;
  onPacksChange: (packs: Pack[]) => void;
}) {
  const [title, setTitle] = useState("本次协作上下文");
  const [selected, setSelected] = useState<Record<string, boolean>>({
    project: true,
    ...(taskId ? { [`task:${taskId}`]: true } : {}),
    ...(conversationId ? { [`conversation:${conversationId}`]: true } : {}),
  });
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedSources = useMemo(() => {
    const sources: Array<{ sourceType: SourceType; sourceId?: string | null; label?: string; included: boolean }> = [];
    if (selected.project) sources.push({ sourceType: "project", included: true });
    tasks.forEach((task) => {
      if (selected[`task:${task.id}`]) sources.push({ sourceType: "task", sourceId: task.id, label: task.name, included: true });
    });
    milestones.forEach((milestone) => {
      if (selected[`milestone:${milestone.id}`]) sources.push({ sourceType: "milestone", sourceId: milestone.id, label: milestone.name, included: true });
    });
    conversations.forEach((conversation) => {
      if (selected[`conversation:${conversation.id}`]) sources.push({ sourceType: "conversation", sourceId: conversation.id, label: conversation.title ?? undefined, included: true });
    });
    return sources;
  }, [conversations, milestones, selected, tasks]);

  function toggle(key: string) {
    setSelected((current) => ({ ...current, [key]: !current[key] }));
  }

  async function previewPack() {
    if (selectedSources.length === 0 || !title.trim()) {
      setMessage("至少保留一条来源，并填写上下文包名称");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/context-packs/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: selectedSources }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "预览失败");
      setPreview(data.items ?? []);
      setMessage(`预览完成：${data.items?.filter((item: PreviewItem) => item.included).length ?? 0} 条来源，${data.totalTextLength ?? 0} 字符`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "预览失败");
    } finally {
      setLoading(false);
    }
  }

  async function createAndFreeze() {
    if (selectedSources.length === 0 || !title.trim()) {
      setMessage("至少保留一条来源，并填写上下文包名称");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const createResponse = await fetch(`/api/projects/${projectId}/context-packs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), conversationId, taskId, sources: selectedSources, status: "draft" }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) throw new Error(created.error ?? "创建失败");
      const freezeResponse = await fetch(`/api/context-packs/${created.pack.id}/freeze`, { method: "POST" });
      const frozen = await freezeResponse.json();
      if (!freezeResponse.ok) throw new Error(frozen.error ?? "冻结失败");
      const nextPack: Pack = {
        id: frozen.pack.id,
        title: frozen.pack.title,
        status: frozen.pack.status,
        summary: frozen.pack.summary,
        frozenAt: frozen.pack.frozenAt,
      };
      onPacksChange([nextPack, ...packs.filter((pack) => pack.id !== nextPack.id)]);
      onSelectPack(nextPack.id);
      setMessage("上下文已冻结，后续发送会使用这份快照");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div>
        <p className="text-[11px] font-medium tracking-[0.08em] text-ink-3">上下文</p>
        <p className="mt-1 text-xs leading-5 text-ink-2">先挑明 AI 可以读取的事实，再冻结成可追溯快照。</p>
      </div>

      <div className="border-b border-stroke pb-3">
        <label className="text-[11px] font-medium text-ink-3" htmlFor="context-pack-title">新建快照</label>
        <input id="context-pack-title" value={title} onChange={(event) => setTitle(event.target.value)} className="ac-field mt-1 text-xs" />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-[11px] font-medium text-ink-3">候选来源</legend>
        <SourceCheckbox label="项目事实" checked={Boolean(selected.project)} onChange={() => toggle("project")} />
        {taskId && <SourceCheckbox label={`当前任务：${tasks.find((item) => item.id === taskId)?.name ?? taskId}`} checked={Boolean(selected[`task:${taskId}`])} onChange={() => toggle(`task:${taskId}`)} />}
        {tasks.filter((task) => task.id !== taskId).slice(0, 5).map((task) => <SourceCheckbox key={task.id} label={task.name} checked={Boolean(selected[`task:${task.id}`])} onChange={() => toggle(`task:${task.id}`)} />)}
        {milestones.slice(0, 4).map((milestone) => <SourceCheckbox key={milestone.id} label={`里程碑：${milestone.name}`} checked={Boolean(selected[`milestone:${milestone.id}`])} onChange={() => toggle(`milestone:${milestone.id}`)} />)}
        {conversationId && <SourceCheckbox label="当前会话" checked={Boolean(selected[`conversation:${conversationId}`])} onChange={() => toggle(`conversation:${conversationId}`)} />}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={previewPack} disabled={loading} className="ac-btn-ghost ac-pressable text-xs">{loading ? "处理中…" : "预览来源"}</button>
        <button type="button" onClick={createAndFreeze} disabled={loading} className="ac-btn ac-pressable text-xs">冻结这份上下文</button>
      </div>

      {preview.length > 0 && (
        <div className="border-t border-stroke pt-3">
          <p className="text-[11px] font-medium text-ink-3">预览结果</p>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-2">
            {preview.map((item, index) => <li key={`${item.sourceType}-${item.label}-${index}`} className="flex items-start justify-between gap-2"><span className="min-w-0 truncate">{item.label}</span><span className="shrink-0 font-mono text-[10px] text-ink-3">{item.included ? `${item.textSize} 字` : "未纳入"}</span></li>)}
          </ul>
        </div>
      )}

      <div className="border-t border-stroke pt-3">
        <p className="text-[11px] font-medium text-ink-3">已冻结</p>
        <div className="mt-2 space-y-1.5">
          {packs.filter((pack) => pack.status === "frozen").map((pack) => <button key={pack.id} type="button" onClick={() => onSelectPack(pack.id)} className={`flex w-full items-start justify-between gap-2 border-l-2 px-2 py-1.5 text-left text-xs ${selectedPackId === pack.id ? "border-agent bg-agent-soft/50 text-ink" : "border-transparent text-ink-2 hover:border-stroke-strong hover:bg-panel"}`}><span className="min-w-0 truncate">{pack.title}</span><span className="shrink-0 text-[10px] text-ink-3">{pack.frozenAt ? new Date(pack.frozenAt).toLocaleDateString("zh-CN") : "已冻结"}</span></button>)}
          {packs.every((pack) => pack.status !== "frozen") && <p className="text-xs text-ink-3">还没有冻结包</p>}
        </div>
      </div>

      {message && <p role="status" className="text-xs leading-5 text-ink-2">{message}</p>}
    </div>
  );
}

function SourceCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <label className="flex min-w-0 items-start gap-2 text-xs text-ink-2"><input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5" /><span className="truncate">{label}</span></label>;
}
