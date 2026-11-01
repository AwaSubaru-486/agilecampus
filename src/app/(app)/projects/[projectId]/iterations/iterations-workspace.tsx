"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/feedback-link";
import { ITERATION_LABELS, ITERATION_STATUSES, type IterationStatus, type IterationTask, type IterationView } from "@/lib/iteration-types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/task-status";
import { saveIterationAction, changeIterationStatusAction } from "./actions";

const tones: Record<IterationStatus, string> = {
  planned: "border-stroke bg-sunken text-ink-2", active: "border-signal/20 bg-signal-soft text-signal", released: "border-done/20 bg-done/10 text-done",
};
function Status({ value }: { value: IterationStatus }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[value]}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{ITERATION_LABELS[value]}</span>;
}
function dateLabel(date: string) { return new Date(date).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }); }

function Dialog({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-label={title} className="ac-task-dialog w-[min(44rem,calc(100vw-2rem))]" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className="flex items-center justify-between gap-3 border-b border-stroke p-5"><h3 className="text-lg font-semibold">{title}</h3><button type="button" aria-label="关闭弹窗" className="ac-btn-ghost min-h-10 min-w-10" disabled={busy} onClick={close}>×</button></div>
    {children}
  </dialog>;
}

function IterationEditor({ projectId, tasks, iteration, close, saved }: { projectId: string; tasks: IterationTask[]; iteration: IterationView | null; close: () => void; saved: () => void }) {
  const [selected, setSelected] = useState(new Set(iteration?.tasks.map(task => task.id) ?? []));
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const visible = tasks.filter(task => `${task.title} ${task.assigneeName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  function submit(data: FormData) {
    startTransition(async () => {
      setError("");
      data.delete("taskIds");
      selected.forEach(id => data.append("taskIds", id));
      try {
        const result = await saveIterationAction(data);
        if ("error" in result) setError(result.error); else saved();
      } catch { setError("保存失败，请检查网络后重试"); }
    });
  }
  return <Dialog title={iteration ? "编辑迭代" : "新建迭代"} busy={pending} close={close}>
    <form onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }} className="p-5 sm:p-6">
      <input type="hidden" name="projectId" value={projectId} />
      {iteration && <><input type="hidden" name="iterationId" value={iteration.id} /><input type="hidden" name="updatedAt" value={iteration.updatedAt} /></>}
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <p className="text-sm leading-6 text-ink-3">明确这一版要交付什么，再把相关任务放进来。新迭代会先保存在计划中。</p>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <label className="block text-sm font-medium">版本号 <span className="text-risk">*</span><input autoFocus name="version" required maxLength={40} defaultValue={iteration?.version} className="ac-field mt-2 w-full" placeholder="如 v1.0.0" /></label>
          <label className="block text-sm font-medium">迭代名称 <span className="text-risk">*</span><input name="title" required maxLength={120} defaultValue={iteration?.title} className="ac-field mt-2 w-full" placeholder="如 首个可用版本" /></label>
        </div>
        <label className="block text-sm font-medium">迭代目标<textarea name="goal" maxLength={5000} defaultValue={iteration?.goal} className="ac-field mt-2 min-h-24 w-full" placeholder="这一版要解决什么问题，达到什么结果？" /></label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm font-medium">开始日期<input type="date" name="startDate" defaultValue={iteration?.startDate ?? ""} className="ac-field mt-2 w-full min-w-0" /></label>
          <label className="block text-sm font-medium">结束日期<input type="date" name="endDate" defaultValue={iteration?.endDate ?? ""} className="ac-field mt-2 w-full min-w-0" /></label>
        </div>
        <section aria-label="关联任务">
          <div className="flex items-center justify-between"><h4 className="text-sm font-medium">关联任务</h4><span className="text-xs text-ink-3">已选 {selected.size} 项</span></div>
          <input type="search" aria-label="搜索项目任务" placeholder="搜索任务或负责人" value={search} onChange={event => setSearch(event.target.value)} className="ac-field mt-2 w-full" />
          <div className="mt-2 max-h-52 overflow-auto rounded-xl border border-stroke p-2">
            {visible.length ? visible.map(task => <label key={task.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-sunken">
              <input type="checkbox" checked={selected.has(task.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(task.id); else next.delete(task.id); return next; })} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-signal)]" />
              <span className="min-w-0 flex-1"><span className="block break-words text-sm">{task.title}</span><span className="mt-1 block text-xs text-ink-3">{task.assigneeName ?? "待分配"} · {STATUS_LABEL[task.status]}</span></span>
            </label>) : <p className="p-4 text-center text-sm text-ink-3">{tasks.length ? "没有匹配的任务" : "项目还没有任务，可以先保存迭代，之后再关联。"}</p>}
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-3">按已验收任务计算进度，关联任务不会改变任务当前状态。</p>
        </section>
        <label className="block text-sm font-medium">版本说明<textarea name="releaseNotes" maxLength={10000} defaultValue={iteration?.releaseNotes} className="ac-field mt-2 min-h-28 w-full" placeholder="记录本版新增、改进和修复的内容，可在发布前继续补充。" /></label>
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm text-risk">{error}</p>}
      <div className="mt-6 flex justify-end gap-3 border-t border-stroke pt-5"><button type="button" onClick={close} disabled={pending} className="ac-btn-ghost">取消</button><button disabled={pending} className="ac-btn">{pending ? "保存中…" : iteration ? "保存修改" : "创建迭代"}</button></div>
    </form>
  </Dialog>;
}

export function IterationsWorkspace({ projectId, iterations, tasks, canManage }: { projectId: string; iterations: IterationView[]; tasks: IterationTask[]; canManage: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | IterationStatus>("all");
  const [editor, setEditor] = useState<{ iteration: IterationView | null } | null>(null);
  const [release, setRelease] = useState<IterationView | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const active = iterations.filter(item => item.status === "active");
  const released = iterations.filter(item => item.status === "released");
  const activeTasks = new Map(active.flatMap(item => item.tasks.map(task => [task.id, task] as const)));
  const complete = [...activeTasks.values()].filter(task => task.status === "done").length;
  const visible = iterations.filter(item => filter === "all" || item.status === filter);
  function change(item: IterationView, action: "start" | "release") {
    setWorkingId(item.id);
    startTransition(async () => {
      setError(""); setMessage("");
      try {
        const result = await changeIterationStatusAction({ projectId, iterationId: item.id, updatedAt: item.updatedAt, action });
        if ("error" in result) setError(result.error);
        else { setRelease(null); setMessage(`${item.version} ${action === "start" ? "已开始" : "已标记为已发布"}`); router.refresh(); }
      } catch { setError("操作失败，请检查网络后重试"); }
      finally { setWorkingId(null); }
    });
  }
  return <main className="space-y-7" data-tour="project-iterations">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-medium tracking-widest text-signal">VERSION & RELEASE</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">版本迭代</h2><p className="mt-2 text-sm leading-6 text-ink-3">从下一版的计划，到每一版的交付，让项目的演进有迹可循。</p></div>
      {canManage && <button onClick={() => { setError(""); setEditor({ iteration: null }); }} className="ac-btn"><span aria-hidden>＋</span> 新建迭代</button>}
    </header>
    <section aria-label="迭代概览" className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border border-stroke bg-panel p-5"><p className="text-xs text-ink-3">正在推进</p><p className="mt-3 text-2xl font-semibold text-signal">{active.length}<span className="ml-2 text-sm font-normal text-ink-3">个迭代</span></p><p className="mt-2 truncate text-xs text-ink-3">{active.length ? active.map(item => item.version).join(" / ") : "下一版，从一个明确的目标开始"}</p></div>
      <div className="rounded-2xl border border-stroke bg-panel p-5"><p className="text-xs text-ink-3">进行中迭代的任务进度</p><p className="mt-3 text-2xl font-semibold tabular-nums">{complete}<span className="ml-1 text-sm font-normal text-ink-3">/ {activeTasks.size} 项已验收</span></p><progress aria-label="进行中迭代任务完成进度" value={complete} max={activeTasks.size || 1} className="mt-3 h-1.5 w-full accent-[var(--color-signal)]" /></div>
      <div className="rounded-2xl border border-stroke bg-panel p-5"><p className="text-xs text-ink-3">已发布版本</p><p className="mt-3 text-2xl font-semibold">{released.length}<span className="ml-2 text-sm font-normal text-ink-3">个版本</span></p><p className="mt-2 text-xs text-ink-3">{released.length ? `最近发布：${[...released].sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""))[0].version}` : "每次交付，都在这里留下记录"}</p></div>
    </section>
    {message && <p role="status" className="rounded-xl border border-signal/20 bg-signal-soft p-3 text-sm text-signal">{message}</p>}
    {error && !release && <p role="alert" className="rounded-xl border border-risk/20 bg-risk-soft p-3 text-sm text-risk">{error}</p>}
    <section aria-label="版本列表">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-stroke pb-3">
        <div role="group" aria-label="按迭代状态筛选" className="flex flex-wrap gap-1">{(["all", ...ITERATION_STATUSES] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-10 rounded-lg px-3 text-sm ${filter === value ? "bg-signal-soft font-semibold text-signal" : "text-ink-3 hover:bg-sunken"}`}>{value === "all" ? "全部版本" : ITERATION_LABELS[value]} <span className="ml-1 text-xs tabular-nums">{value === "all" ? iterations.length : iterations.filter(item => item.status === value).length}</span></button>)}</div>
        <span className="text-xs text-ink-3">按创建时间排列 · 最新在前</span>
      </div>
      {!visible.length ? <div className="rounded-2xl border border-dashed border-stroke-strong bg-panel px-6 py-16 text-center">
        <div aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-signal-soft text-2xl text-signal">↗</div>
        <h3 className="mt-5 text-lg font-semibold">{iterations.length ? "这个状态下还没有迭代" : "为项目规划第一个版本"}</h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-ink-3">{iterations.length ? "切换状态，查看其他版本的规划与交付记录。" : canManage ? "写下版本目标、安排交付周期并关联任务。团队就能一起看清这一版要完成什么。" : "组长创建迭代后，你可以在这里查看版本目标、任务进度和发布记录。"}</p>
        {canManage && !iterations.length && <button onClick={() => setEditor({ iteration: null })} className="ac-btn mt-6">＋ 新建迭代</button>}
      </div> : <ol className="space-y-5">{visible.map(item => {
        const done = item.tasks.filter(task => task.status === "done").length;
        const remaining = item.tasks.length - done;
        return <li key={item.id}>
          <article className={`overflow-hidden rounded-2xl border bg-panel ${item.status === "active" ? "border-signal/40" : "border-stroke"}`}>
            <div className={`h-1 ${item.status === "active" ? "bg-signal" : item.status === "released" ? "bg-done/40" : "bg-stroke"}`} />
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h3 className="break-all text-xl font-semibold tracking-tight">{item.version}</h3><Status value={item.status} /></div><p className="mt-2 break-words text-base text-ink-2">{item.title}</p></div>
                {canManage && item.status !== "released" && <div className="flex flex-wrap gap-2"><button disabled={pending} className="ac-btn-ghost" onClick={() => setEditor({ iteration: item })}>编辑<span className="sr-only"> {item.version}</span></button>{item.status === "planned" ? <button disabled={pending} className="ac-btn" onClick={() => change(item, "start")}>{pending && workingId === item.id ? "开始中…" : "开始迭代"}<span className="sr-only"> {item.version}</span></button> : <button disabled={pending} className="ac-btn" onClick={() => { setError(""); setRelease(item); }}>标记已发布<span className="sr-only"> {item.version}</span></button>}</div>}
              </div>
              {item.goal && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-ink-2">{item.goal}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-3"><span>计划周期：{item.startDate || "待定"} — {item.endDate || "待定"}</span>{item.releasedAt && <span>发布于 {dateLabel(item.releasedAt)}</span>}</div>
              <div className="mt-5 rounded-xl bg-sunken/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium text-ink-2">{item.status === "released" ? "发布时的任务记录" : "任务验收进度"}</span><span className="tabular-nums text-ink-3">{done} / {item.tasks.length} 项{item.tasks.length > 0 ? ` · ${Math.round(done / item.tasks.length * 100)}%` : " · 暂未关联任务"}</span></div><progress aria-label={`${item.version} 任务验收进度`} value={done} max={item.tasks.length || 1} className="mt-3 h-1.5 w-full accent-[var(--color-signal)]" /></div>
              <details open={item.status === "active"} className="mt-4 border-t border-stroke pt-4"><summary className="cursor-pointer text-sm font-medium text-ink-2">版本内容与关联任务</summary>
                <div className="mt-5 grid gap-6 lg:grid-cols-2"><section><h4 className="text-xs font-semibold text-ink-3">版本说明</h4><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-ink-2">{item.releaseNotes || "暂未填写版本说明。"}</p></section>
                  <section><h4 className="text-xs font-semibold text-ink-3">关联任务 · {item.tasks.length} 项</h4>{item.tasks.length ? <ul className="mt-2 max-h-80 divide-y divide-stroke overflow-auto">{item.tasks.map(task => <li key={task.id} className="flex items-start gap-3 py-3"><span aria-hidden className={`mt-0.5 text-sm ${task.status === "done" ? "text-done" : "text-ink-3"}`}>{task.status === "done" ? "✓" : "○"}</span><div className="min-w-0 flex-1"><Link className="break-words text-sm text-ink hover:text-signal hover:underline" href={`/projects/${projectId}?space=work&task=${task.id}`}>{task.title}</Link><p className="mt-1 text-xs text-ink-3">{task.assigneeName ?? "待分配"}</p></div><span className={`shrink-0 text-xs ${STATUS_TONE[task.status]}`}>{STATUS_LABEL[task.status]}</span></li>)}</ul> : <p className="mt-3 text-sm text-ink-3">暂未关联任务。</p>}</section>
                </div>
                {item.status === "released" && <p className="mt-5 text-xs leading-6 text-ink-3">任务名称、负责人和状态保留发布时的记录；点击任务可查看当前详情。</p>}
                {item.status === "active" && remaining > 0 && <p className="mt-4 text-xs text-ink-3">还有 {remaining} 项任务待验收完成。</p>}
              </details>
            </div>
          </article>
        </li>;
      })}</ol>}
    </section>
    {editor && <IterationEditor projectId={projectId} tasks={tasks} iteration={editor.iteration} close={() => setEditor(null)} saved={() => { setEditor(null); setFilter("all"); setMessage("迭代已保存"); router.refresh(); }} />}
    {release && <Dialog title={`发布 ${release.version}`} busy={pending} close={() => { setRelease(null); setError(""); }}><div className="space-y-5 p-6"><p className="text-sm leading-7 text-ink-2">确认这一版已经交付。标记已发布后，将保存当前版本说明与任务记录，作为历史版本保留。</p><div className="rounded-xl bg-sunken p-4"><p className="font-semibold">{release.version} · {release.title}</p><p className="mt-2 text-sm text-ink-3">{release.tasks.filter(task => task.status === "done").length} / {release.tasks.length} 项关联任务已验收</p></div>{release.tasks.some(task => task.status !== "done") && <p role="status" className="text-sm leading-6 text-risk">请先完成关联任务的验收，或编辑本版任务范围。</p>}{!release.tasks.length && <p className="text-sm text-ink-3">本版没有关联任务，将仅保存版本说明。</p>}{error && <p role="alert" className="text-sm text-risk">{error}</p>}<div className="flex justify-end gap-3"><button disabled={pending} className="ac-btn-ghost" onClick={() => { setRelease(null); setError(""); }}>取消</button><button className="ac-btn" disabled={pending || release.tasks.some(task => task.status !== "done")} onClick={() => change(release, "release")}>{pending ? "保存发布记录…" : "确认已发布"}</button></div></div></Dialog>}
  </main>;
}
