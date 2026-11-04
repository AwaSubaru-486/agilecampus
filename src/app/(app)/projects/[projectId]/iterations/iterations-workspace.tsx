"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FEATURE_CHANGE_LABELS, type IterationView } from "@/lib/iteration-types";
import { changeIterationStatusAction } from "./actions";
import { FeatureTimeline } from "./feature-timeline";
import { IterationEditor } from "./iteration-editor";
import { IterationExecution } from "./iteration-execution";
import { IterationDialog, IterationStatusBadge, iterationDate } from "./iteration-ui";
import styles from "./iterations.module.css";

export function IterationsWorkspace({ projectId, iterations, canManage }: { projectId: string; iterations: IterationView[]; canManage: boolean }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ iteration: IterationView | null; base: IterationView | null } | null>(null);
  const [archive, setArchive] = useState<IterationView | null>(null);
  const [release, setRelease] = useState<IterationView | null>(null);
  const [dirtyId, setDirtyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const releases = iterations.filter(item => item.status === "released").sort((a, b) => (b.releasedAt ?? b.createdAt).localeCompare(a.releasedAt ?? a.createdAt));
  const upcoming = iterations.filter(item => item.status !== "released");
  const current = upcoming.find(item => item.id === selectedId) ?? upcoming.find(item => item.status === "active") ?? upcoming[0];
  const baseline = iterations.find(item => item.id === current?.baseIterationId);
  const dirty = dirtyId === current?.id;
  const ready = !!current?.features.length && !!current?.goal && !!current?.validationNotes && !!current?.releaseNotes && !dirty;
  function newIteration(base: IterationView | null = releases[0] ?? null) {
    if (dirty && !window.confirm("当前推进记录尚未保存，仍要规划另一个版本吗？")) return;
    setEditor({ iteration: null, base }); setError("");
  }
  function changed(text: string) { setMessage(text); setError(""); setDirtyId(null); router.refresh(); }
  function change(item: IterationView, action: "start" | "release") {
    startTransition(async () => {
      setError(""); setMessage("");
      try {
        const result = await changeIterationStatusAction({ projectId, iterationId: item.id, updatedAt: item.updatedAt, action });
        if ("error" in result) setError(result.error);
        else { setRelease(null); changed(action === "start" ? `${item.version} 已开始，可以记录本轮推进与验证。` : `${item.version} 已发布，功能模块已加入上方演进图。`); }
      } catch { setError("操作失败，请检查网络后重试"); }
    });
  }
  function selectVersion(item: IterationView) {
    if (current?.id === item.id) return;
    if (dirty && !window.confirm("当前推进记录尚未保存，仍要切换版本吗？")) return;
    setSelectedId(item.id); setDirtyId(null); setError(""); setMessage("");
  }
  return <main className={styles.workspace} data-tour="project-iterations">
    <header className={styles.pageHeader}><div><h2>版本迭代</h2><p>看清项目已有的能力，推进下一次功能变化。</p></div>{canManage && <button className="ac-btn" onClick={() => newIteration()}>＋ 规划下一版</button>}</header>
    <FeatureTimeline releases={releases} openVersion={setArchive} />
    <section className={styles.workbench} aria-labelledby="iteration-workbench-title">
      <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>02 / 推进下一次变化</p><h2 id="iteration-workbench-title">迭代工作台</h2><p className={styles.muted}>确定这一版的功能范围，记录实施与验证，完成后发布。</p></div><span className={styles.workbenchCount}>{upcoming.length} 个未发布版本</span></header>
      {message && <p role="status" className={styles.success}>{message}</p>}
      {error && !release && <p role="alert" className={styles.error}>{error}</p>}
      {current ? <div className={styles.workbenchGrid}>
        <nav aria-label="选择正在推进的版本" className={styles.versionNav}>
          <p>版本规划</p>{upcoming.map(item => <button key={item.id} onClick={() => selectVersion(item)} aria-pressed={current.id === item.id} className={current.id === item.id ? styles.selectedVersion : ""}><span><strong>{item.version}</strong><IterationStatusBadge status={item.status} /></span><span>{item.title}</span></button>)}
          {canManage && <button className={styles.planAnother} onClick={() => newIteration()}>＋ 规划一个版本</button>}
        </nav>
        <article className={styles.versionDetail}>
          <header className={styles.detailHeader}><div><div className={styles.versionHeading}><span>{current.version}</span><IterationStatusBadge status={current.status} /></div><h3>{current.title}</h3><p>{baseline ? `基于 ${baseline.version} · ${baseline.title}` : "独立版本规划"}<span> · {current.startDate ?? "开始待定"} — {current.endDate ?? "交付待定"}</span></p></div>
            {canManage && <div className={styles.detailActions}><button className="ac-btn-ghost" disabled={pending || dirty} onClick={() => setEditor({ iteration: current, base: baseline ?? null })}>调整范围</button>{current.status === "planned" ? <button className="ac-btn" disabled={pending} onClick={() => change(current, "start")}>{pending ? "开始中…" : "开始迭代"}</button> : <button className="ac-btn" disabled={pending || !ready} onClick={() => { setError(""); setRelease(current); }}>发布本版</button>}</div>}
          </header>
          <section className={styles.goal}><h4>本版要带来的变化</h4><p>{current.goal || "还未明确本版目标，可以先调整范围。"}</p></section>
          <section className={styles.scope} aria-label="本轮功能范围"><div className={styles.subheading}><h4>本轮功能范围</h4><span>{current.features.length} 个模块</span></div>
            {current.features.length ? <ul className={styles.scopeModules}>{current.features.map(feature => <li key={feature.id}><div><span className={`${styles.changeLabel} ${styles[feature.change]}`}>{FEATURE_CHANGE_LABELS[feature.change]}</span><h5>{feature.name}</h5></div><p>{feature.summary}</p></li>)}</ul> : <p className={styles.muted}>添加这一版要新增或改善的功能模块。</p>}
          </section>
          {current.status === "planned" ? <div className={styles.startNote}><span aria-hidden>↗</span><div><strong>准备好本轮目标，就可以开始迭代</strong><p>开始后，在这里记录方案、推进情况和验证结果。</p></div></div> : <section className={styles.execution}>
            <div className={styles.subheading}><h4>实施与交付</h4><span>{dirty ? "有未保存的修改" : "按本版整体记录"}</span></div>
            <IterationExecution key={`${current.id}:${current.updatedAt}`} projectId={projectId} iteration={current} canManage={canManage} dirty={() => setDirtyId(current.id)} saved={() => changed("推进与验证已保存。")} />
            {canManage && !ready && <p className={styles.publishHint}>{dirty ? "先保存当前修改，再发布本版。" : "补齐功能范围、验证结果和发布说明后，即可发布到功能演进图。"}</p>}
          </section>}
        </article>
      </div> : <div className={styles.emptyWorkbench}><span aria-hidden>↗</span><h3>{releases.length ? "下一次变化，从这里开始" : "先为项目规划一个版本"}</h3><p>{releases.length ? "选定下一版的目标和功能变化，再记录实施与交付。" : "写下版本目标，选出本轮要新增或改善的功能模块。"}</p>{canManage && <button className="ac-btn" onClick={() => newIteration()}>{releases.length ? `基于 ${releases[0].version} 规划下一版` : "规划首个版本"}</button>}</div>}
    </section>
    {editor && <IterationEditor projectId={projectId} iteration={editor.iteration} base={editor.base} releases={releases} close={() => setEditor(null)} saved={() => { setEditor(null); changed("版本范围已保存。"); }} />}
    {archive && <IterationDialog title={`${archive.version} · 发布档案`} close={() => setArchive(null)}><div className={styles.archiveContent}>
      <div className={styles.versionHeading}><span>{archive.version}</span><IterationStatusBadge status="released" /></div><h3>{archive.title}</h3><p className={styles.muted}>发布于 {iterationDate(archive.releasedAt ?? archive.createdAt)}</p>
      <section><h4>本版目标</h4><p>{archive.goal || "未记录目标。"}</p></section>
      <section><h4>已交付的功能模块</h4><ul className={styles.archiveFeatures}>{archive.features.map(feature => <li key={feature.id}><span className={`${styles.changeLabel} ${styles[feature.change]}`}>{FEATURE_CHANGE_LABELS[feature.change]}</span><strong>{feature.name}</strong><p>{feature.summary}</p></li>)}</ul>{!archive.features.length && <p>原有版本未记录模块级功能。</p>}</section>
      <section><h4>发布说明</h4><p>{archive.releaseNotes || "未填写。"}</p></section><section><h4>验证结果</h4><p>{archive.validationNotes || "原有版本未记录验证结果。"}</p></section>
      {archive.releaseUrl && <a className={styles.textLink} href={archive.releaseUrl} target="_blank" rel="noreferrer">查看版本成果 ↗</a>}
      {canManage && <div className={styles.formFooter}><button className="ac-btn" onClick={() => { newIteration(archive); setArchive(null); }}>基于此版规划下一轮</button></div>}
    </div></IterationDialog>}
    {release && <IterationDialog title={`发布 ${release.version}`} busy={pending} close={() => { setRelease(null); setError(""); }}><div className={styles.archiveContent}>
      <p>确认这一版的功能已经实现，并完成所记录的验证。发布后，这些模块会加入上方功能演进图，作为本版交付保留。</p>
      <div className={styles.releaseSummary}><strong>{release.version} · {release.title}</strong><ul>{release.features.map(feature => <li key={feature.id}>{FEATURE_CHANGE_LABELS[feature.change]} · {feature.name}</li>)}</ul></div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.formFooter}><button className="ac-btn-ghost" disabled={pending} onClick={() => setRelease(null)}>继续完善</button><button className="ac-btn" disabled={pending} onClick={() => change(release, "release")}>{pending ? "发布中…" : "确认发布功能"}</button></div>
    </div></IterationDialog>}
  </main>;
}
