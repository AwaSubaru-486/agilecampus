"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TaskTreePayload } from "@/lib/task-tree";
import { emptyDraftPlan, validateDraftPlan, type DraftPlan, type PlanningLink } from "@/lib/draft-planning";
import { mapTimelinePlan } from "@/lib/timeline-task-tree";
import { DraftTechTree } from "../task-tree/draft-tech-tree";

export type TimelineTreeGroup = {
  id: string; title: string; payload: TaskTreePayload; draftId?: string; draftStageIndex?: number; pending: boolean;
  links: PlanningLink[]; details: { key: string; taskId: string | null; status: string; owner: string }[];
};
type Draft = { id: string; payload: TaskTreePayload };

export function TimelineTaskTrees({ projectId, groups, drafts }: { projectId: string; groups: TimelineTreeGroup[]; drafts: Draft[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [cached, setCached] = useState<Record<string, DraftPlan>>({});
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const found: Record<string, DraftPlan> = {};
      for (const draft of drafts) {
        try {
          const stored = JSON.parse(localStorage.getItem(`agilecampus.draft-planning.v1.${draft.id}`) ?? "null");
          if (stored?.signature !== JSON.stringify(draft.payload)) continue;
          validateDraftPlan(draft.payload, stored.plan); found[draft.id] = stored.plan;
        } catch { /* Ignore stale/corrupt annotations; do not invent dependencies. */ }
      }
      setCached(found);
    });
    return () => cancelAnimationFrame(frame);
  }, [drafts]);
  if (!groups.length) return <div className="ac-card p-8 text-sm text-ink-3">还没有任务树。发布阶段任务后可以在这里查看，组长也可以查看待确认草案。</div>;
  const group = groups.find(item => item.id === groupId) ?? groups[0];
  let plan = emptyDraftPlan(group.payload);
  let local = false;
  const draft = drafts.find(item => item.id === group.draftId);
  const cachedStage = group.draftId ? cached[group.draftId]?.stages.find(item => item.stageIndex === group.draftStageIndex) : null;
  if (draft && cachedStage) {
    const mapped = mapTimelinePlan(group.payload, draft.payload.stages[group.draftStageIndex!], cachedStage.links);
    if (mapped) { plan = mapped; local = true; }
  }
  if (!local) plan.stages[0].links = group.links;
  // Stored task relations remain authoritative; local planning overlays only fill otherwise unconnected nodes.
  if (local) for (const link of group.links) if (link.afterKeys.length) {
    plan.stages[0].links = plan.stages[0].links.map(item => item.key === link.key ? link : item);
  }
  let invalid = false;
  try { validateDraftPlan(group.payload, plan); } catch { plan = emptyDraftPlan(group.payload); invalid = true; local = false; }
  const linked = plan.stages[0].links.some(link => link.afterKeys.length);
  const task = group.payload.stages[0].tasks.find(item => item.key === selected);
  const detail = group.details.find(item => item.key === selected);
  return <section className="space-y-4" aria-label="时间线任务树">
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-3 text-sm">阶段或草案<select aria-label="选择任务树阶段" className="ac-field" value={group.id} onChange={event => { setGroupId(event.target.value); setSelected(null); }}>{groups.map(item => <option key={item.id} value={item.id}>{item.title}{item.pending ? "，待确认草案" : "，已发布"}</option>)}</select></label>
      {group.pending && <Link className="ac-btn-ghost" href={`/projects/${projectId}/task-tree?plan=1#planning`}>回到草案调整 →</Link>}
    </div>
    <p className="text-xs leading-6 text-ink-3">{invalid ? "现有连接包含无法展示的关系，暂时只显示任务，请回到执行台核对。" : local ? "包含此浏览器保存的草案编排；实际任务后续关系优先。规划连线不会改变执行规则。" : linked ? "显示项目中已设置的任务后续关系。" : "尚未设置先后关系，当前仅列出任务；不把排列顺序当成执行前置。"}</p>
    <DraftTechTree draftId={group.id} tasks={group.payload.stages[0].tasks} plan={plan.stages[0]} selectedKey={selected}
      members={group.details.map(item => ({ id: item.key, name: `${item.owner}，${item.status}` }))} disabled readOnly analysed={linked || local}
      onSelect={setSelected} onAdd={() => {}} onDelete={() => {}} onConnect={() => {}} />
    {task && <aside className="ac-tech-inspector"><h3 className="font-semibold">{task.title}</h3><p className="mt-2 text-xs text-ink-3">{detail?.owner}，{detail?.status}</p><p className="mt-3 text-sm leading-7">{task.description || "暂无执行说明"}</p><ul className="mt-3 space-y-2 text-sm">{task.doneCriteria.map((text, index) => <li key={index}>✓ {text}</li>)}</ul><p className="mt-3 text-xs text-ink-3">连接理由：{plan.stages[0].links.find(link => link.key === selected)?.reason}</p>{detail?.taskId && <Link className="mt-4 inline-block text-sm text-signal" href={`/projects/${projectId}?space=work&task=${detail.taskId}`}>打开任务详情 →</Link>}</aside>}
  </section>;
}
