"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { TaskTreePayload } from "@/lib/task-tree";
import { emptyDraftPlan, followingTasks, removePlannedTask, validateDraftPlan, type DraftPlan, type DraftTask } from "@/lib/draft-planning";
import type { DraftTaskSuggestion } from "@/lib/draft-planning-ai";
import { saveDraftAction, type TreeActionState } from "./actions";
import { DraftActions } from "./task-tree-forms";
import { DraftTechTree } from "./draft-tech-tree";

type NewTask = { title: string; description: string; doneCriteria: string[]; afterKeys: string[]; parentKey: string | null };
const INITIAL_NOTE = "尚未进行 AI 关系分析";

export function DraftEditor({ projectId, draftId, payload, members }: {
  projectId: string; draftId: string; payload: TaskTreePayload; members: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(payload);
  const [saved, setSaved] = useState(JSON.stringify(payload));
  const [plan, setPlan] = useState<DraftPlan>(() => emptyDraftPlan(payload));
  const [savedPlan, setSavedPlan] = useState(JSON.stringify(emptyDraftPlan(payload)));
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(payload.stages[0]?.tasks[0]?.key ?? null);
  const [newTask, setNewTask] = useState<NewTask | null>(null);
  const [suggestion, setSuggestion] = useState<DraftTaskSuggestion | null>(null);
  const [busy, setBusy] = useState<"plan" | "refine" | null>(null);
  const [notice, setNotice] = useState("");
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [keepFollowing, setKeepFollowing] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const autoStarted = useRef(false);
  const alive = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const id = useId();
  const cacheKey = `agilecampus.draft-planning.v1.${draftId}`;
  const serialized = JSON.stringify(value);
  const dirtyPayload = serialized !== saved;
  const dirty = dirtyPayload || JSON.stringify(plan) !== savedPlan;
  const stage = value.stages[stageIndex];
  const stagePlan = plan.stages.find(item => item.stageIndex === stageIndex)!;
  const selected = stage.tasks.find(task => task.key === selectedKey);
  const groups = new Set(stage.tasks.flatMap(task => task.parentKey ? [task.parentKey] : []));
  const [state, action, pending] = useActionState<TreeActionState, FormData>(async (previous, data) => {
    const result = dirtyPayload ? await saveDraftAction(previous, data) : { success: "编排关系已保存到此浏览器" };
    if (result?.success) {
      setSaved(String(data.get("payload"))); setSavedPlan(JSON.stringify(plan));
      try { localStorage.setItem(cacheKey, JSON.stringify({ signature: String(data.get("payload")), plan })); }
      catch { setNotice("任务资料已保存；浏览器无法保存编排关系，请勿关闭此页面。"); }
    }
    return result;
  }, null);
  const disabled = pending || busy !== null;

  async function ask(body: object) {
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch("/api/draft-planning", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ projectId, draftId, payload: value, ...body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "AI 分析未完成，请重试");
      return result as { plan?: DraftPlan; suggestion?: DraftTaskSuggestion };
    } finally { controllers.current.delete(controller); }
  }
  async function analyse() {
    if (busy) return;
    setBusy("plan"); setNotice("");
    try {
      const result = await ask({ mode: "plan" });
      if (!alive.current || !result.plan) return;
      validateDraftPlan(value, result.plan);
      setPlan(result.plan);
      if (!dirtyPayload) {
        setSavedPlan(JSON.stringify(result.plan));
        localStorage.setItem(cacheKey, JSON.stringify({ signature: serialized, plan: result.plan }));
      }
      setNotice("AI 已完成关系安排和第二轮复核。请检查连线理由，再确认发布。");
    } catch (error) { if (alive.current) setNotice(error instanceof Error && error.name === "AbortError" ? "已停止分析，可以继续手动编排。" : error instanceof Error ? error.message : "AI 关系分析未完成，可以手动编排。"); }
    finally { if (alive.current) setBusy(null); }
  }
  useEffect(() => {
    alive.current = true;
    const activeControllers = controllers.current;
    const frame = requestAnimationFrame(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as { signature: string; plan: DraftPlan } | null;
        if (cached?.signature === JSON.stringify(payload)) {
          validateDraftPlan(payload, cached.plan);
          setPlan(cached.plan); setSavedPlan(JSON.stringify(cached.plan)); return;
        }
      } catch { /* Corrupt or stale local annotations are recomputed, never used as task dependencies. */ }
      void analyse();
    });
    return () => { cancelAnimationFrame(frame); alive.current = false; activeControllers.forEach(controller => controller.abort()); };
    // One analysis per draft mount; edits are reviewed only by the explicit button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);
  useEffect(() => { if (removeKey && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [removeKey]);

  function changeTask(key: string, patch: Partial<DraftTask>) {
    setValue(current => ({ ...current, stages: current.stages.map((item, index) => index === stageIndex
      ? { ...item, tasks: item.tasks.map(task => task.key === key ? { ...task, ...patch } : task) } : item) }));
  }
  function connect(key: string, target: string | null, parallel: boolean) {
    const afterKeys = target ? parallel ? stagePlan.links.find(link => link.key === target)?.afterKeys ?? [] : [target] : [];
    updatePredecessors(key, afterKeys);
  }
  function updatePredecessors(key: string, afterKeys: string[]) {
    const next: DraftPlan = { ...plan, source: "manual", reviewNote: "已手动调整编排，可让 AI 重新安排与复核。",
      stages: plan.stages.map(item => item.stageIndex === stageIndex ? { ...item, links: item.links.map(link => link.key === key
        ? { ...link, afterKeys, reason: "手动调整的先后关系" } : link) } : item) };
    try { validateDraftPlan(value, next); setPlan(next); setNotice("任务分支已调整，请保存编排。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "任务连接不正确"); }
  }
  function beginAdd(key: string | null) {
    setSuggestion(null); setNotice(""); setSelectedKey(null);
    setNewTask({ title: "", description: "", doneCriteria: [""], afterKeys: key && !groups.has(key) ? [key] : [], parentKey: key && groups.has(key) ? key : null });
  }
  async function refine() {
    if (!newTask?.title.trim() || busy) { setNotice("先为新任务填写名称，再请 AI 检查。"); return; }
    setBusy("refine"); setNotice("");
    try {
      const result = await ask({ mode: "refine", stageIndex, title: newTask.title, afterKeys: newTask.afterKeys });
      if (alive.current && result.suggestion) setSuggestion(result.suggestion);
    } catch (error) { if (alive.current) setNotice(error instanceof Error && error.name === "AbortError" ? "已停止分析，可以手动完善任务。" : error instanceof Error ? error.message : "AI 建议未完成"); }
    finally { if (alive.current) setBusy(null); }
  }
  function add() {
    if (!newTask) return;
    const criteria = newTask.doneCriteria.map(text => text.trim()).filter(Boolean);
    if (!newTask.title.trim() || !criteria.length) { setNotice("请填写任务名称和至少一项验收标准，或先应用 AI 建议。"); return; }
    if (criteria.length > 8 || criteria.some(text => text.length > 300)) { setNotice("验收标准最多 8 项，每项不超过 300 字。"); return; }
    if (stage.tasks.length >= 40 || value.stages.reduce((sum, item) => sum + item.tasks.length, 0) >= 60) { setNotice("本阶段最多 40 个任务，整份草案最多 60 个。"); return; }
    const key = `manual-${crypto.randomUUID()}`;
    const task: DraftTask = { key, parentKey: newTask.parentKey, title: newTask.title.trim(), description: newTask.description,
      assigneeId: null, priority: "medium", doneCriteria: criteria };
    const nextValue = { ...value, stages: value.stages.map((item, index) => index === stageIndex ? { ...item, tasks: [...item.tasks, task] } : item) };
    const nextPlan: DraftPlan = { ...plan, source: "manual", reviewNote: "已新增任务，请核对连接或让 AI 重新安排与复核。", stages: plan.stages.map(item => item.stageIndex === stageIndex
      ? { ...item, links: [...item.links, { key, afterKeys: newTask.afterKeys, reason: suggestion ? "新增任务，已查看 AI 建议" : "手动添加，请核对前置条件" }] } : item) };
    validateDraftPlan(nextValue, nextPlan);
    setValue(nextValue); setPlan(nextPlan); setSelectedKey(key); setNewTask(null); setSuggestion(null); setNotice("任务已加入草案，请保存后再发布。");
  }
  function remove() {
    if (!removeKey) return;
    try {
      const result = removePlannedTask(value, plan, stageIndex, removeKey, keepFollowing);
      setValue(result.payload); setPlan(result.plan); setStageIndex(Math.min(stageIndex, result.payload.stages.length - 1));
      setSelectedKey(null); setRemoveKey(null); setNotice(keepFollowing ? "任务已移除，后续任务保留并接回原来的前置条件。请保存。" : "任务及其后续任务已从草案移除，请保存。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法删除任务"); }
  }
  const descendants = removeKey ? followingTasks(stage.tasks, stagePlan, removeKey) : new Set<string>();
  const relation = selected ? stagePlan.links.find(link => link.key === selected.key) : null;
  const analysed = plan.reviewNote !== INITIAL_NOTE;
  return <div data-tour="tutorial-draft-editor" className="space-y-4">
    <fieldset disabled={disabled} className="space-y-4 min-w-0">
      <legend className="sr-only">编辑任务草案与科技树编排</legend>
      <details className="ac-disclosure"><summary>项目规划说明</summary><label className="block p-4 text-xs text-ink-3">规划说明<textarea className="ac-field mt-2 w-full" rows={2} maxLength={1000} value={value.summary} onChange={event => setValue({ ...value, summary: event.target.value })} /></label></details>
      <div className="flex flex-wrap items-center justify-between gap-3"><nav aria-label="草案阶段" className="flex flex-wrap gap-2">{value.stages.map((item, index) => <button key={index} type="button" className={`ac-tech-stage ${stageIndex === index ? "is-active" : ""}`} aria-pressed={stageIndex === index} onClick={() => { setStageIndex(index); setSelectedKey(item.tasks[0]?.key ?? null); setNewTask(null); setSuggestion(null); }}>{index + 1}. {item.title}</button>)}</nav>
        <button type="button" className="ac-btn-ghost" onClick={() => void analyse()}>AI 重新安排与复核</button></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex min-w-0 items-center gap-2 text-xs text-ink-3">阶段名称<input className="ac-field min-w-0" aria-label={`阶段 ${stageIndex + 1} 名称`} maxLength={120} value={stage.title} onChange={event => setValue({ ...value, stages: value.stages.map((item, index) => index === stageIndex ? { ...item, title: event.target.value } : item) })} /></label><button type="button" className="ac-btn-ghost" onClick={() => beginAdd(null)}>＋ 添加并行起点</button></div>
      {stageIndex > 0 && <p className="text-xs text-ink-3">本阶段在上一阶段集成审核通过后开始。</p>}
      <DraftTechTree draftId={draftId} tasks={stage.tasks} plan={stagePlan} selectedKey={selectedKey} members={members} disabled={disabled} analysed={analysed}
        onSelect={key => { setSelectedKey(key); setNewTask(null); setSuggestion(null); }} onAdd={beginAdd}
        onDelete={key => { setRemoveKey(key); setKeepFollowing(true); }} onConnect={connect} />
      {selected && <section className="ac-tech-inspector"><header className="mb-4 flex items-center justify-between"><h3 className="font-semibold">任务详情</h3><button type="button" className="text-xs text-ink-3" onClick={() => setSelectedKey(null)}>收起</button></header>
        <div className="grid gap-4 md:grid-cols-2"><label className="text-xs text-ink-3 md:col-span-2">任务名称<input className="ac-field mt-1 w-full" maxLength={160} value={selected.title} onChange={event => changeTask(selected.key, { title: event.target.value })} /></label>
          <label className="text-xs text-ink-3">负责人<select className="ac-field mt-1 w-full" value={selected.assigneeId ?? ""} onChange={event => changeTask(selected.key, { assigneeId: event.target.value || null })}><option value="">待分配</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label className="text-xs text-ink-3">优先级<select className="ac-field mt-1 w-full" value={selected.priority} onChange={event => changeTask(selected.key, { priority: event.target.value as DraftTask["priority"] })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label className="text-xs text-ink-3">执行说明<textarea className="ac-field mt-1 w-full" rows={3} maxLength={2000} value={selected.description} onChange={event => changeTask(selected.key, { description: event.target.value })} /></label>
          <label className="text-xs text-ink-3">验收标准（每行一项）<textarea className="ac-field mt-1 w-full" rows={3} value={selected.doneCriteria.join("\n")} onChange={event => changeTask(selected.key, { doneCriteria: event.target.value.split("\n") })} /></label>
        </div>
        {!groups.has(selected.key) && <details className="mt-4"><summary className="cursor-pointer text-xs text-signal">前置任务与连接理由</summary><p className="my-3 text-xs leading-6 text-ink-3">{relation?.reason}</p><div className="flex flex-wrap gap-3">{stage.tasks.filter(task => task.key !== selected.key && !groups.has(task.key)).map(task => <label key={task.key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={relation?.afterKeys.includes(task.key) ?? false} onChange={event => updatePredecessors(selected.key, event.target.checked ? [...relation?.afterKeys ?? [], task.key] : relation?.afterKeys.filter(key => key !== task.key) ?? [])} />{task.title}</label>)}</div><p className="mt-3 text-xs text-ink-3">无前置是起点；多个前置表示等待它们汇合。这里也可以用键盘调整分支。</p></details>}
      </section>}
      {newTask && <section className="ac-tech-inspector"><h3 className="font-semibold">新增任务</h3><p className="mt-2 text-xs text-ink-3">{newTask.parentKey ? `加入分组：${stage.tasks.find(task => task.key === newTask.parentKey)?.title}` : newTask.afterKeys.length ? `接在：${newTask.afterKeys.map(key => stage.tasks.find(task => task.key === key)?.title).join("、")}` : "作为本阶段的并行起点"}</p>
        <label className="mt-4 block text-xs text-ink-3">小任务名称<input className="ac-field mt-1 w-full" maxLength={160} value={newTask.title} onChange={event => { setNewTask({ ...newTask, title: event.target.value }); setSuggestion(null); }} /></label>
        <button type="button" className="ac-btn mt-3" onClick={() => void refine()}>让 AI 检查位置并完善任务</button>
        {suggestion && <div className="mt-4 rounded-xl border border-signal/30 bg-signal-soft/40 p-4"><p className="text-sm font-semibold">{suggestion.fit === "suitable" ? "AI 判断：适合接在这里" : suggestion.fit === "parallel" ? "AI 判断：建议并行或调整前置" : "AI 判断：不建议这样接入"}</p><p className="mt-2 text-sm leading-6">{suggestion.reason}</p><p className="mt-3 text-xs text-ink-3">建议前置：{suggestion.afterKeys.length ? suggestion.afterKeys.map(key => stage.tasks.find(task => task.key === key)?.title).join("、") : "无需前置，可并行开始"}</p><ul className="mt-3 space-y-1 text-xs">{suggestion.doneCriteria.map((text, index) => <li key={index}>✓ {text}</li>)}</ul><button type="button" className="ac-btn-ghost mt-3" onClick={() => setNewTask({ ...newTask, title: suggestion.title, description: suggestion.description, doneCriteria: suggestion.doneCriteria, afterKeys: suggestion.afterKeys })}>应用建议到新增表单</button></div>}
        <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs text-ink-3">执行说明<textarea className="ac-field mt-1 w-full" maxLength={2000} rows={3} value={newTask.description} onChange={event => setNewTask({ ...newTask, description: event.target.value })} /></label><label className="text-xs text-ink-3">验收标准（每行一项）<textarea className="ac-field mt-1 w-full" rows={3} value={newTask.doneCriteria.join("\n")} onChange={event => setNewTask({ ...newTask, doneCriteria: event.target.value.split("\n") })} /></label></div>
        <div className="mt-4 flex gap-3"><button type="button" className="ac-btn" onClick={add}>确认添加任务</button><button type="button" className="ac-btn-ghost" onClick={() => { setNewTask(null); setSuggestion(null); }}>取消</button></div>
      </section>}
    </fieldset>
    {busy && <div className="flex flex-wrap items-center gap-3"><p role="status" className="flex items-center gap-2 text-sm text-signal"><span className="ac-loading-dot" aria-hidden />{busy === "plan" ? "AI 正在安排任务关系，并单独复核必要前置与并行分支…" : "AI 正在对照项目目标，检查任务位置与验收标准…"}</p><button type="button" className="ac-btn-ghost" onClick={() => controllers.current.forEach(controller => controller.abort())}>停止分析，手动编排</button></div>}
    {notice && <p role="status" className="text-sm leading-6 text-ink-2">{notice}</p>}
    <details className="text-xs text-ink-3"><summary className="cursor-pointer">{plan.source === "ai" ? "查看 AI 二次复核结论" : "查看编排说明"}</summary><p className="mt-2 leading-6">{plan.reviewNote}</p></details>
    <form action={action} onReset={event => event.preventDefault()} className="flex flex-wrap items-center justify-between gap-3">
      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="draftId" value={draftId} /><input type="hidden" name="payload" value={serialized} />
      <p id={`${id}-status`} role={state?.error ? "alert" : "status"} className={`text-xs ${state?.error ? "text-risk" : "text-ink-3"}`}>{state?.error ?? (dirty ? "有未保存修改，请先保存再发布。" : state?.success ?? "检查任务、分工与验收标准后发布。")}</p>
      <button className="ac-btn-ghost" disabled={disabled || !dirty} aria-describedby={`${id}-status`}>{pending ? "保存中…" : "保存修改与编排"}</button>
    </form>
    <p className="text-xs leading-6 text-ink-3">任务资料保存到项目，编排连线保存在当前浏览器。此图用于草案规划；发布后继续沿用现有阶段流程。</p>
    <DraftActions projectId={projectId} draftId={draftId} disabled={dirty || disabled} />
    {removeKey && <dialog ref={dialog} className="ac-tech-delete-dialog" aria-labelledby={`${id}-delete-title`} onCancel={event => { event.preventDefault(); setRemoveKey(null); }}>
      <h3 id={`${id}-delete-title`} className="text-xl font-semibold">确认删除这个任务？</h3><p className="mt-3 text-sm">{stage.tasks.find(task => task.key === removeKey)?.title}</p>
      {descendants.size > 0 ? <fieldset className="mt-5 space-y-3"><legend className="mb-3 text-sm text-ink-3">它后面关联了 {descendants.size} 个任务，请选择处理方式：</legend><label className="flex items-start gap-2 text-sm"><input type="radio" name={`${id}-keep`} checked={keepFollowing} onChange={() => setKeepFollowing(true)} />保留后续任务，接回原来的前置条件</label><label className="flex items-start gap-2 text-sm"><input type="radio" name={`${id}-keep`} checked={!keepFollowing} onChange={() => setKeepFollowing(false)} />一起删除全部后续任务（含汇合任务）</label><p className="text-xs leading-6 text-ink-3">{stage.tasks.filter(task => descendants.has(task.key)).map(task => task.title).join("、")}</p></fieldset> : <p className="mt-4 text-sm text-ink-3">没有后续任务，只移除这一项。</p>}
      {stage.tasks.length === descendants.size + 1 && !keepFollowing && value.stages.length > 1 && <p className="mt-3 text-xs text-risk">本阶段将没有任务，因此也会移除这个空阶段。</p>}
      {value.stages.length === 1 && (keepFollowing ? 1 : descendants.size + 1) >= stage.tasks.length && <p className="mt-3 text-sm text-risk">草案至少需要保留一个任务，请先添加其他任务。</p>}
      <div className="mt-6 flex gap-3"><button type="button" className="ac-btn-ghost" onClick={() => setRemoveKey(null)}>取消</button><button type="button" className="ac-btn" disabled={value.stages.length === 1 && (keepFollowing ? 1 : descendants.size + 1) >= stage.tasks.length} onClick={remove}>确认删除{!keepFollowing && descendants.size ? "及后续任务" : "任务"}</button></div>
    </dialog>}
  </div>;
}
