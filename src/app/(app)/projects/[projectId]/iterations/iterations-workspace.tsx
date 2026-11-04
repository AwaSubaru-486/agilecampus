"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IterationModule, IterationView } from "@/lib/iteration-types";
import { iterationContext, iterationModules, moduleChanges } from "@/lib/iteration-modules";
import { continueIterationAction, saveWorkspaceAction } from "./actions";
import { FeatureTimeline } from "./feature-timeline";
import { IterationDialog, iterationDate } from "./iteration-ui";
import styles from "./iterations.module.css";

export function IterationsWorkspace({ projectId, iterations, canManage }: { projectId: string; iterations: IterationView[]; canManage: boolean }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [archive, setArchive] = useState<IterationView | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const releases = iterations.filter(item => item.status === "released").sort((a, b) => (b.releasedAt ?? b.createdAt).localeCompare(a.releasedAt ?? a.createdAt));
  const upcoming = iterations.filter(item => item.status !== "released");
  const current = upcoming.find(item => item.id === selectedId) ?? upcoming.find(item => item.status === "active") ?? upcoming[0];
  function resume(baseId: string | null, existingId?: string) {
    if (dirty && !window.confirm("工作断点尚未保存，仍要离开当前开发版本吗？")) return;
    startTransition(async () => {
      setError("");
      try {
        const result = await continueIterationAction({ projectId, baseId, existingId });
        if ("error" in result) setError(result.error);
        else { setSelectedId(result.id); setArchive(null); router.refresh(); }
      } catch { setError("操作失败，请检查网络后重试"); }
    });
  }
  return <main className={styles.workspace} data-tour="project-iterations">
    <header className={styles.pageHeader}><div><h2>版本迭代</h2><p>接着已有成果开发，让每一次变化留得下来。</p></div>{canManage && releases[0] && current?.baseIterationId !== releases[0].id && <button className="ac-btn" disabled={pending} onClick={() => resume(releases[0].id)}>接着 {releases[0].version} 继续开发</button>}</header>
    <FeatureTimeline releases={releases} openVersion={setArchive} />
    <section className={styles.workbench} aria-labelledby="iteration-workbench-title">
      <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>02 / 在已有成果上继续</p><h2 id="iteration-workbench-title">当前开发版本</h2><p className={styles.muted}>选择一个模块继续修改，查看变化，满意后保存成版本。</p></div></header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {upcoming.length > 1 && <nav className={styles.draftTabs} aria-label="未保存的开发版本">{upcoming.map(item => <button key={item.id} aria-pressed={current?.id === item.id} onClick={() => { if (!dirty || window.confirm("工作断点尚未保存，仍要切换版本吗？")) setSelectedId(item.id); }}>{item.version} · {item.title}</button>)}</nav>}
      {current ? <DevelopmentWorkspace key={`${current.id}:${current.updatedAt}`} projectId={projectId} current={current} iterations={iterations} canManage={canManage} onDirty={setDirty} saved={() => router.refresh()} />
        : <div className={styles.emptyWorkbench}><span aria-hidden>↗</span><h3>{releases.length ? `接着 ${releases[0].version}，继续把项目做好` : "从第一个功能开始"}</h3><p>{releases.length ? "已有模块、成果链接和开发备注会一起带入，无需重新填写。" : "先添加一个模块，写一句它能做什么，就可以开始。"}</p>{canManage && <button className="ac-btn" disabled={pending} onClick={() => resume(releases[0]?.id ?? null)}>{pending ? "准备中…" : releases.length ? "继续开发" : "开始开发"}</button>}</div>}
    </section>
    {archive && <IterationDialog title={`${archive.version} · 版本成果`} close={() => setArchive(null)}><div className={styles.archiveContent}>
      <h3>{archive.title}</h3><p className={styles.muted}>保存于 {iterationDate(archive.releasedAt ?? archive.createdAt)} · {iterationModules(archive, iterations).length} 个已有模块</p>
      <Changes modules={iterationModules(archive, iterations)} baseline={iterationModules(iterations.find(item => item.id === archive.baseIterationId), iterations)} />
      <details><summary>查看全部模块与开发备注</summary><ul className={styles.archiveFeatures}>{iterationModules(archive, iterations).map(item => <li key={item.id}><strong>{item.name}</strong><p>{item.summary}</p>{item.context && <p>开发备注：{item.context}</p>}{item.resultUrl && <a className={styles.textLink} href={item.resultUrl} target="_blank" rel="noreferrer">打开成果 ↗</a>}</li>)}</ul></details>
      {archive.executionNotes && <section><h4>留下的开发上下文</h4><p>{archive.executionNotes}</p></section>}
      {archive.validationNotes && <details><summary>原有验证记录</summary><p>{archive.validationNotes}</p></details>}
      {archive.releaseUrl && <a className={styles.textLink} href={archive.releaseUrl} target="_blank" rel="noreferrer">打开本版成果 ↗</a>}
      {canManage && <button className="ac-btn" disabled={pending} onClick={() => resume(archive.id)}>接着此版继续开发</button>}
    </div></IterationDialog>}
  </main>;
}

function Changes({ modules, baseline }: { modules: IterationModule[]; baseline: IterationModule[] }) {
  const changes = moduleChanges(modules, baseline);
  return <div className={styles.changeList}>{!changes.length && <p className={styles.muted}>还没有功能变化。已有能力会继续保留。</p>}{changes.map(change => {
    const before = baseline.find(item => item.id === change.id);
    const after = modules.find(item => item.id === change.id)!;
    return <section key={change.id} className={styles.changeComparison}><h4>{change.name}<span className={`${styles.changeLabel} ${before ? styles.improved : styles.added}`}>{before ? "在原模块上改进" : "新能力"}</span></h4><div className={styles.compareGrid}><div><small>上一版</small><p>{before?.summary ?? "尚无此模块"}</p>{before?.resultUrl && <a href={before.resultUrl} target="_blank" rel="noreferrer">打开原成果 ↗</a>}</div><div><small>这一版</small><p>{after.summary}</p>{after.resultUrl && <a href={after.resultUrl} target="_blank" rel="noreferrer">打开当前成果 ↗</a>}</div></div></section>;
  })}</div>;
}

function DevelopmentWorkspace({ projectId, current, iterations, canManage, onDirty, saved }: { projectId: string; current: IterationView; iterations: IterationView[]; canManage: boolean; onDirty: (dirty: boolean) => void; saved: () => void }) {
  const baselineVersion = iterations.find(item => item.id === current.baseIterationId);
  const baseline = iterationModules(baselineVersion, iterations);
  const modules = iterationModules(current, iterations);
  const changes = moduleChanges(modules, baseline);
  const [editing, setEditing] = useState<IterationModule | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState(current.executionNotes);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const noteDirty = note !== current.executionNotes;
  useEffect(() => { onDirty(noteDirty); return () => onDirty(false); }, [noteDirty, onDirty]);
  useEffect(() => {
    if (!noteDirty) return;
    function guard(event: BeforeUnloadEvent) { event.preventDefault(); }
    function guardLink(event: MouseEvent) {
      const link = (event.target as Element).closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank" || link.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm("工作断点尚未保存，仍要离开吗？")) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", guardLink, true);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("click", guardLink, true); };
  }, [noteDirty]);
  async function persist(nextModules = modules, publish = false, version = current.version, title = current.title) {
    setError(""); setMessage("");
    try {
      const result = await saveWorkspaceAction({ projectId, iterationId: current.id, updatedAt: current.updatedAt, modules: nextModules, executionNotes: note, version, title, publish });
      if ("error" in result) { setError(result.error); return; }
      setEditing(null); setPublishing(false); saved();
    } catch { setError("保存失败，修改仍保留在这里，请重试。"); }
  }
  function copyContext() {
    navigator.clipboard.writeText(iterationContext({ ...current, executionNotes: note }, modules, baseline)).then(() => setMessage("已复制模块现状、前后变化、成果链接和工作断点，可粘贴到开发对话中继续。"), () => setError("复制失败，请检查浏览器剪贴板权限。"));
  }
  return <article className={styles.developmentWorkspace}>
    <header className={styles.detailHeader}><div><div className={styles.versionHeading}><span>{current.version}</span><span className={styles.badge}>开发中 · 尚未存为历史版本</span></div><h3>{current.title}</h3><p>{baselineVersion ? `接续自 ${baselineVersion.version} · ${baselineVersion.title}` : "从首个版本开始"}</p></div><div className={styles.detailActions}><button className="ac-btn-ghost" onClick={copyContext}>复制开发上下文</button>{canManage && <button className="ac-btn" disabled={pending || !changes.length} onClick={() => setPublishing(true)}>保存成版本</button>}</div></header>
    <div className={styles.continuityStrip}><span>{baseline.length} 个模块接着用</span><strong>{changes.length} 个模块有变化</strong><span>其余能力沿用上一版</span></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
    <div className={styles.moduleToolbar}><div role="group" aria-label="模块视图"><button aria-pressed={!showChanges} onClick={() => setShowChanges(false)}>项目模块 · {modules.length}</button><button aria-pressed={showChanges} onClick={() => setShowChanges(true)}>查看本轮变化 · {changes.length}</button></div>{canManage && <button className="ac-btn-ghost" disabled={pending} onClick={() => setEditing({ id: crypto.randomUUID(), name: "", summary: "", resultUrl: "", context: "" })}>＋ 新增模块</button>}</div>
    {showChanges ? <Changes modules={modules} baseline={baseline} /> : <div className={styles.moduleGrid}>{[...modules].sort((a, b) => Number(changes.some(item => item.id === b.id)) - Number(changes.some(item => item.id === a.id))).map(module => {
      const before = baseline.find(item => item.id === module.id);
      const changed = changes.some(item => item.id === module.id);
      return <section key={module.id} className={`${styles.moduleCard} ${changed ? styles.changedModule : ""}`}><div><span className={`${styles.changeLabel} ${changed ? before ? styles.improved : styles.added : styles.unchanged}`}>{changed ? before ? "本轮改进" : "本轮新增" : `沿用 ${baselineVersion?.version ?? "已有能力"}`}</span><h4>{module.name}</h4></div><p>{module.summary}</p>{module.context && <p className={styles.moduleContext}>开发备注：{module.context}</p>}<footer>{module.resultUrl ? <a className={styles.textLink} href={module.resultUrl} target="_blank" rel="noreferrer">打开成果 ↗</a> : <span className={styles.muted}>可附演示、设计或代码链接</span>}{canManage && <button className="ac-btn-ghost" disabled={pending} onClick={() => setEditing(module)}>继续修改 →</button>}</footer></section>;
    })}{!modules.length && <div className={styles.emptyWorkbench}><h3>先添加一个你正在开发的模块</h3><p>例如“在线报名”，写一句当前希望它能做什么。</p></div>}</div>}
    <details className={styles.contextDetails}><summary>工作断点与开发背景 <span>随手记，下一轮会带上</span></summary><div className={styles.formFields}><label>下次接着哪里做<textarea className="ac-input" rows={3} maxLength={10000} value={note} disabled={!canManage || pending} onChange={event => setNote(event.target.value)} placeholder="可留方案、发现或下一步；不需要填写完整复盘。" /></label>{current.releaseUrl && <a className={styles.textLink} href={current.releaseUrl} target="_blank" rel="noreferrer">打开继承的项目成果 ↗</a>}{canManage && <button className="ac-btn-ghost" disabled={pending || !noteDirty} onClick={() => startTransition(async () => { await persist(); })}>保存断点</button>}</div></details>
    {noteDirty && <p role="status" className={styles.publishHint}>工作断点尚未保存；保存模块或保存成版本时会一起保存。</p>}
    {editing && <ModuleEditor key={editing.id} module={editing} before={baseline.find(item => item.id === editing.id)} busy={pending} error={error} close={() => setEditing(null)} save={module => startTransition(async () => { await persist(modules.some(item => item.id === module.id) ? modules.map(item => item.id === module.id ? module : item) : [...modules, module]); })} />}
    {publishing && <IterationDialog title="把当前成果保存成版本" busy={pending} close={() => setPublishing(false)}><form className={styles.editorForm} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(async () => { await persist(modules, true, String(data.get("version")), String(data.get("title"))); }); }}><div className={styles.formFields}><p className={styles.muted}>确认这些变化已达到你希望保留的效果。保存后加入上方演进图，全部模块、成果链接和上下文将作为本版快照保留。</p><div className={styles.formPair}><label>版本号<input className="ac-input" name="version" defaultValue={current.version} required maxLength={40} disabled={pending} /></label><label>给这次变化起个名字<input className="ac-input" name="title" defaultValue={current.title} required maxLength={120} disabled={pending} /></label></div><Changes modules={modules} baseline={baseline} />{error && <p role="alert" className={styles.error}>{error}</p>}</div><div className={styles.formFooter}><button type="button" className="ac-btn-ghost" disabled={pending} onClick={() => setPublishing(false)}>继续开发</button><button className="ac-btn" disabled={pending}>{pending ? "保存中…" : "确认保存版本"}</button></div></form></IterationDialog>}
  </article>;
}

function ModuleEditor({ module, before, busy, error, close, save }: { module: IterationModule; before?: IterationModule; busy: boolean; error: string; close: () => void; save: (module: IterationModule) => void }) {
  const [draft, setDraft] = useState(module);
  const dirty = JSON.stringify(draft) !== JSON.stringify(module);
  function dismiss() { if (!dirty || window.confirm("模块修改还未保存，确定离开吗？")) close(); }
  return <IterationDialog title={module.name ? `继续修改 · ${module.name}` : "新增功能模块"} busy={busy} close={dismiss}><form className={styles.editorForm} onSubmit={event => { event.preventDefault(); save(draft); }}><div className={styles.formFields}>
    <label>功能模块<input className="ac-input" value={draft.name} required maxLength={60} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：在线报名" /></label>
    {before && <div className={styles.previousCapability}><small>上一版已能做到</small><p>{before.summary}</p></div>}
    <label>改完后，这个模块能做什么？<textarea className="ac-input" value={draft.summary} required maxLength={500} rows={4} disabled={busy} onChange={event => setDraft({ ...draft, summary: event.target.value })} placeholder="例如：满员后可以加入候补，空出名额时按顺序通知。" /><span className={styles.fieldHint}>在已有描述上直接修改，系统会保留上一版供你对照。</span></label>
    <details><summary>成果链接与开发备注（可选）</summary><div className={styles.formFields}><label>可打开的成果<input className="ac-input" type="url" pattern="https?://.*" maxLength={2000} value={draft.resultUrl} disabled={busy} onChange={event => setDraft({ ...draft, resultUrl: event.target.value })} placeholder="演示页面、设计稿或仓库链接" /></label><label>给继续开发的人留句话<textarea className="ac-input" rows={3} maxLength={5000} value={draft.context} disabled={busy} onChange={event => setDraft({ ...draft, context: event.target.value })} placeholder="方案、发现、还没做完的部分……" /></label></div></details>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div><div className={styles.formFooter}><button type="button" className="ac-btn-ghost" disabled={busy} onClick={dismiss}>取消</button><button className="ac-btn" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></div></form></IterationDialog>;
}
