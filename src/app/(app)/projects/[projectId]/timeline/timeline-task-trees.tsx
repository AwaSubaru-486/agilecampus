"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { TaskTreePayload } from "@/lib/task-tree";
import { emptyDraftPlan, validateDraftPlan, type DraftPlan, type PlanningLink } from "@/lib/draft-planning";
import { mapWholeTimelinePlan, planningSignature } from "@/lib/timeline-task-tree";
import { DraftTechTree } from "../task-tree/draft-tech-tree";
import { TaskSubmissionForm } from "../_shared/task-submit-dialog";
import type { EvidenceType } from "@/lib/handoff";
import { LoadingProgress } from "@/components/loading-progress";
import { usePlanningAnimation } from "../_shared/use-planning-animation";

export type TimelineTreeGroup = {
  id: string; title: string; payload: TaskTreePayload; draftId?: string; draftStageIndex?: number; pending: boolean;
  links: PlanningLink[]; details: { handoffVersion?: number; requiredEvidence?: EvidenceType[]; key: string; taskId: string | null; status: string; owner: string; completed?: boolean; completionNote?: string | null; reviewNote?: string | null; dueDate?: string | null; canDeliver?: boolean; delivery?: { branchName: string; testSummary: string | null; pullRequestUrl: string | null } | null }[];
};
type Draft = { id: string; payload: TaskTreePayload };

export function TimelineTaskTrees({ projectId, projectName, canAnalyse, groups, drafts }: { projectId: string; projectName: string; canAnalyse: boolean; groups: TimelineTreeGroup[]; drafts: Draft[] }) {
  const [treeId, setTreeId] = useState(groups.some(group => !group.pending) ? "published" : groups[0]?.draftId ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  const [focusStage, setFocusStage] = useState(0);
  const [stored, setStored] = useState<{ signature: string; plan: DraftPlan } | null>(null);
  const { busy, start: analyse, stop } = usePlanningAnimation();
  const visible = groups.filter(group => treeId === "published" ? !group.pending : group.pending && group.draftId === treeId);
  const original = drafts.find(draft => draft.id === treeId)?.payload;
  const payload: TaskTreePayload = { summary: treeId === "published" ? projectName : original?.summary ?? projectName, stages: visible.map(group => group.payload.stages[0]) };
  const signature = planningSignature(payload);
  const cacheKey = treeId === "published" ? `agilecampus.timeline-planning.v2.${projectId}` : `agilecampus.draft-planning.v1.${treeId}`;
  const basePlan = emptyDraftPlan(payload);
  basePlan.stages.forEach((stage, index) => { stage.links = visible[index].links; });
  let plan = stored?.signature === signature ? structuredClone(stored.plan) : basePlan;
  if (stored?.signature === signature) plan.stages.forEach((stage, index) => {
    stage.links = stage.links.map(link => {
      const existing = visible[index].links.find(item => item.key === link.key);
      return existing?.afterKeys.length ? { ...link, afterKeys: [...new Set([...link.afterKeys, ...existing.afterKeys])] } : link;
    });
  });
  let invalid = false;
  try { validateDraftPlan(payload, plan); } catch { plan = basePlan; invalid = true; }
  try { validateDraftPlan(payload, plan); } catch { plan = emptyDraftPlan(payload); invalid = true; }
  const linked = plan.stages.some(stage => stage.links.some(link => link.afterKeys.length));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
        const expected = treeId === "published" ? signature : JSON.stringify(original);
        if (cached?.relationVersion === 2 && cached.signature === expected) {
          validateDraftPlan(payload, cached.plan);
          setStored({ signature, plan: cached.plan });
          return;
        }
      } catch { /* Stale/corrupt graphs must be recomputed. */ }
      if (treeId === "published") {
        const recovered = structuredClone(basePlan);
        const covered = new Set<number>();
        for (const draft of drafts) {
          try {
            const cached = JSON.parse(localStorage.getItem(`agilecampus.draft-planning.v1.${draft.id}`) ?? "null");
            if (cached?.relationVersion !== 2 || cached.signature !== JSON.stringify(draft.payload)) continue;
            const matches = visible.flatMap((group, index) => group.draftId === draft.id ? [{ group, index }] : []).sort((a, b) => (a.group.draftStageIndex ?? 0) - (b.group.draftStageIndex ?? 0));
            const mapped = mapWholeTimelinePlan({ summary: payload.summary, stages: matches.map(item => item.group.payload.stages[0]) }, draft.payload, cached.plan);
            if (!mapped) continue;
            matches.forEach((item, index) => { recovered.stages[item.index] = { ...mapped.stages.find(stage => stage.stageIndex === index)!, stageIndex: item.index }; covered.add(item.index); });
          } catch { /* Never guess connections for changed tasks. */ }
        }
        if (covered.size) {
          try {
            validateDraftPlan(payload, recovered);
            recovered.reviewNote = "已保留现有阶段的编排与项目中登记的关系。";
            setStored({ signature, plan: recovered });
            return;
          } catch { /* Fall through to full-project analysis. */ }
        }
      }
      setStored(null);
    });
    return () => cancelAnimationFrame(frame);
    // Restore existing annotations only. Opening the page never starts an AI request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, signature, canAnalyse]);

  if (!groups.length) return <div className="ac-card p-8 text-sm text-ink-3">还没有任务树。发布阶段任务后可以在这里查看，组长也可以查看待确认草案。</div>;
  const task = payload.stages.flatMap(stage => stage.tasks).find(item => item.key === selected);
  const detail = visible.flatMap(group => group.details).find(item => item.key === selected);
  const pendingDrafts = drafts.filter(draft => groups.some(group => group.pending && group.draftId === draft.id));
  return <section className="space-y-4" aria-label="时间线任务树">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-3 text-sm">查看任务链<select aria-label="选择任务链" className="ac-field" disabled={busy} value={treeId} onChange={event => { setTreeId(event.target.value); setFocusStage(0); setSelected(null); setStored(null); }}>
        {groups.some(group => !group.pending) && <option value="published">整个项目，已发布任务</option>}
        {pendingDrafts.map((draft, index) => <option key={draft.id} value={draft.id}>待确认草案 {index + 1}：{draft.payload.summary.slice(0, 35)}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-3">{treeId !== "published" && <Link className="ac-btn-ghost" href={`/projects/${projectId}/task-tree?plan=1#planning`}>回到草案调整 →</Link>}
        {canAnalyse && <button type="button" className="ac-btn-ghost" disabled={busy} onClick={() => void analyse()}>AI 分析整条任务链</button>}
      </div>
    </div>
    <p className="text-xs leading-6 text-ink-3">从左向右推进，分支表示并行，连线表示需要的前置成果。竖向虚线划分阶段，跨阶段依赖会继续连线。</p>
    <nav data-tour="timeline-stages" aria-label="定位任务树阶段" className="flex flex-wrap gap-2">{payload.stages.map((stage, index) => <button data-tour="stage-link" type="button" key={index} className={`ac-tech-stage ${focusStage === index ? "is-active" : ""}`} aria-pressed={focusStage === index} onClick={() => setFocusStage(index)}>{index + 1}. {stage.title}</button>)}</nav>
    {busy && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-signal/20 bg-signal-soft p-4 text-sm text-signal"><LoadingProgress className="flex-1 min-w-48" label="AI 正在分析任务链…" detail="动画演示，任务与连线保持原样。" /><button type="button" className="ac-btn-ghost" onClick={stop}>停止分析</button></div>}
    {invalid && <p role="alert" className="text-sm text-risk">已忽略存在冲突的编排，显示项目已登记的关系。请在草案中核对任务关系。</p>}
    {!linked && <p className="text-xs text-ink-3">任务按阶段展示，已登记的前置关系会显示连线。</p>}
    <DraftTechTree key={treeId} draftId={`${projectId}-${treeId}`} tasks={payload.stages.flatMap(stage => stage.tasks)} plan={{ stageIndex: 0, links: plan.stages.flatMap(stage => stage.links) }} sections={payload.stages.map(stage => ({ title: stage.title, keys: stage.tasks.map(task => task.key) }))} focusStage={focusStage} selectedKey={selected}
      completedKeys={visible.flatMap(group => group.details.filter(item => item.completed).map(item => item.key))}
      members={visible.flatMap(group => group.details).map(item => ({ id: item.key, name: `${item.owner}，${item.status}` }))} disabled readOnly analysed={linked}
      onSelect={setSelected} onAdd={() => {}} onDelete={() => {}} onConnect={() => {}} />
    {stored?.signature === signature && <details className="text-xs text-ink-3"><summary className="cursor-pointer">查看任务链编排说明</summary><p className="mt-2 leading-6">{plan.reviewNote}</p><p className="mt-2">规划连线保存在当前浏览器，不改变任务执行规则。</p></details>}
    {task && <dialog ref={dialog} data-tour="timeline-inspector" aria-label={`任务详情：${task.title}`} className="ac-task-dialog" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-stroke bg-panel p-5"><div><p className="text-xs text-ink-3">任务详情，{detail?.status}</p><h3 className="mt-2 text-lg font-semibold">{task.title}</h3></div><button type="button" data-tour="timeline-close" className="ac-btn-ghost" aria-label="关闭任务详情" onClick={() => dialog.current?.close()}>关闭 ×</button></header>
      <div className="space-y-5 p-5"><p className="text-sm text-ink-3">负责人：{detail?.owner}{detail?.dueDate ? `，截止 ${detail.dueDate}` : ""}</p><section><h4 className="text-sm font-semibold">任务目标</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{task.description || "暂无执行说明"}</p></section><section><h4 className="text-sm font-semibold">完成条件</h4><ul className="mt-2 space-y-2 text-sm">{task.doneCriteria.map((text, index) => <li key={index}>□ {text}</li>)}</ul></section>
      {detail?.completionNote && <section><h4 className="text-sm font-semibold">提交成果</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{detail.completionNote}</p></section>}
      {detail?.reviewNote && <section><h4 className="text-sm font-semibold">验收意见</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{detail.reviewNote}</p></section>}
      {detail?.delivery && <section><h4 className="text-sm font-semibold">交付资料</h4><p className="mt-2 break-all text-sm">分支：{detail.delivery.branchName}</p><p className="mt-2 whitespace-pre-wrap text-sm">{detail.delivery.testSummary}</p>{detail.delivery.pullRequestUrl && /^https?:\/\//i.test(detail.delivery.pullRequestUrl) && <a className="mt-2 inline-block text-sm text-signal" href={detail.delivery.pullRequestUrl} target="_blank" rel="noreferrer">查看成果链接 ↗</a>}</section>}
      {detail?.taskId && detail.canDeliver && <section className="space-y-3"><h4 className="text-sm font-semibold text-signal">提交任务</h4><TaskSubmissionForm key={detail.taskId} projectId={projectId} task={{ ...task, id: detail.taskId, handoffVersion: detail.handoffVersion }} evidenceTypes={detail.requiredEvidence} onSubmitted={() => dialog.current?.close()} /></section>}
      </div>
    </dialog>}
  </section>;
}
