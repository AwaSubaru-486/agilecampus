"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { TaskTreePayload } from "@/lib/task-tree";
import { emptyDraftPlan, validateDraftPlan, type DraftPlan, type PlanningLink } from "@/lib/draft-planning";
import { mapWholeTimelinePlan, planningSignature } from "@/lib/timeline-task-tree";
import { DraftTechTree } from "../task-tree/draft-tech-tree";

export type TimelineTreeGroup = {
  id: string; title: string; payload: TaskTreePayload; draftId?: string; draftStageIndex?: number; pending: boolean;
  links: PlanningLink[]; details: { key: string; taskId: string | null; status: string; owner: string }[];
};
type Draft = { id: string; payload: TaskTreePayload };

export function TimelineTaskTrees({ projectId, projectName, canAnalyse, groups, drafts }: { projectId: string; projectName: string; canAnalyse: boolean; groups: TimelineTreeGroup[]; drafts: Draft[] }) {
  const [treeId, setTreeId] = useState(groups.some(group => !group.pending) ? "published" : groups[0]?.draftId ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusStage, setFocusStage] = useState(0);
  const [stored, setStored] = useState<{ signature: string; plan: DraftPlan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
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

  async function analyse() {
    if (controller.current || !canAnalyse || !payload.stages.length) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/draft-planning", { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify(treeId === "published" ? { mode: "timeline", projectId } : { mode: "plan", projectId, draftId: treeId, payload: original }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "AI 分析没有完成");
      if (request.signal.aborted) return;
      if (result.signature && result.signature !== signature) throw new Error("项目任务已经变化，请刷新后重新分析");
      validateDraftPlan(payload, result.plan);
      setStored({ signature, plan: result.plan });
      try { localStorage.setItem(cacheKey, JSON.stringify({ relationVersion: 2, signature: treeId === "published" ? signature : JSON.stringify(original), plan: result.plan })); }
      catch { setNotice("AI 编排已展示，但浏览器无法保存，请勿关闭此页。"); }
    } catch (error) {
      if (!request.signal.aborted) setNotice(error instanceof Error ? error.message : "AI 分析没有完成，请重试");
    } finally {
      if (controller.current === request) { controller.current = null; setBusy(false); }
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBusy(false);
      setNotice("");
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
        const recovered = emptyDraftPlan(payload);
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
        if (covered.size === payload.stages.length && covered.size) {
          try {
            validateDraftPlan(payload, recovered);
            recovered.reviewNote = "已保留发布前在此浏览器保存的编排，可按需要让 AI 再次复核。";
            setStored({ signature, plan: recovered });
            return;
          } catch { /* Fall through to full-project analysis. */ }
        }
      }
      void analyse();
    });
    return () => { cancelAnimationFrame(frame); controller.current?.abort(); controller.current = null; };
    // One analysis for each unchanged complete task set, never per stage or per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, signature, canAnalyse]);

  if (!groups.length) return <div className="ac-card p-8 text-sm text-ink-3">还没有任务树。发布阶段任务后可以在这里查看，组长也可以查看待确认草案。</div>;
  const task = payload.stages.flatMap(stage => stage.tasks).find(item => item.key === selected);
  const detail = visible.flatMap(group => group.details).find(item => item.key === selected);
  const pendingDrafts = drafts.filter(draft => groups.some(group => group.pending && group.draftId === draft.id));
  return <section className="space-y-4" aria-label="时间线任务树">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-3 text-sm">查看任务链<select aria-label="选择任务链" className="ac-field" disabled={busy} value={treeId} onChange={event => { setTreeId(event.target.value); setFocusStage(0); setSelected(null); setStored(null); setNotice(""); }}>
        {groups.some(group => !group.pending) && <option value="published">整个项目，已发布任务</option>}
        {pendingDrafts.map((draft, index) => <option key={draft.id} value={draft.id}>待确认草案 {index + 1}：{draft.payload.summary.slice(0, 35)}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-3">{treeId !== "published" && <Link className="ac-btn-ghost" href={`/projects/${projectId}/task-tree?plan=1#planning`}>回到草案调整 →</Link>}
        {canAnalyse && <button type="button" className="ac-btn-ghost" disabled={busy} onClick={() => void analyse()}>AI 分析整条任务链</button>}
      </div>
    </div>
    <p className="text-xs leading-6 text-ink-3">从左向右推进，分支表示并行，连线表示需要的前置成果。竖向虚线划分阶段，跨阶段依赖会继续连线。</p>
    <nav aria-label="定位任务树阶段" className="flex flex-wrap gap-2">{payload.stages.map((stage, index) => <button type="button" key={index} className={`ac-tech-stage ${focusStage === index ? "is-active" : ""}`} aria-pressed={focusStage === index} onClick={() => setFocusStage(index)}>{index + 1}. {stage.title}</button>)}</nav>
    {busy && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-signal/20 bg-signal-soft p-4 text-sm text-signal"><span className="ac-loading-dot" aria-hidden />AI 正在分析所有阶段的先后与并行关系，并进行第二轮复核…<button type="button" className="ac-btn-ghost" onClick={() => { controller.current?.abort(); controller.current = null; setBusy(false); setNotice("已停止分析，可以稍后重试。"); }}>停止分析</button></div>}
    {notice && <p role="alert" className="text-sm text-risk">{notice}</p>}
    {invalid && <p role="alert" className="text-sm text-risk">任务关系存在冲突，已忽略无法采用的编排，请重新分析或核对任务关系。</p>}
    {!busy && !linked && <p className="text-xs text-ink-3">尚未确认任务先后关系。{canAnalyse ? "请让 AI 分析任务链；分析失败时不会编造连线。" : "请组长先分析任务链。"}</p>}
    {(!busy || linked) && <DraftTechTree draftId={`${projectId}-${treeId}`} tasks={payload.stages.flatMap(stage => stage.tasks)} plan={{ stageIndex: 0, links: plan.stages.flatMap(stage => stage.links) }} sections={payload.stages.map(stage => ({ title: stage.title, keys: stage.tasks.map(task => task.key) }))} focusStage={focusStage} selectedKey={selected}
      members={visible.flatMap(group => group.details).map(item => ({ id: item.key, name: `${item.owner}，${item.status}` }))} disabled readOnly analysed={linked}
      onSelect={setSelected} onAdd={() => {}} onDelete={() => {}} onConnect={() => {}} />}
    {stored?.signature === signature && <details className="text-xs text-ink-3"><summary className="cursor-pointer">查看任务链编排说明</summary><p className="mt-2 leading-6">{plan.reviewNote}</p><p className="mt-2">规划连线保存在当前浏览器，不改变任务执行规则。</p></details>}
    {task && <aside className="ac-tech-inspector"><h3 className="font-semibold">{task.title}</h3><p className="mt-2 text-xs text-ink-3">{detail?.owner}，{detail?.status}</p><p className="mt-3 text-sm leading-7">{task.description || "暂无执行说明"}</p><ul className="mt-3 space-y-2 text-sm">{task.doneCriteria.map((text, index) => <li key={index}>✓ {text}</li>)}</ul><p className="mt-3 text-xs text-ink-3">连接理由：{plan.stages.flatMap(stage => stage.links).find(link => link.key === selected)?.reason}</p>{detail?.taskId && <Link className="mt-4 inline-block text-sm text-signal" href={`/projects/${projectId}?space=work&task=${detail.taskId}`}>打开任务详情 →</Link>}</aside>}
  </section>;
}
