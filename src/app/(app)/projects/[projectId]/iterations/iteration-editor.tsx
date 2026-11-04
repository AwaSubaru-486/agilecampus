"use client";

import { useState, useTransition } from "react";
import { FEATURE_CHANGES, FEATURE_CHANGE_LABELS, type IterationFeature, type IterationView } from "@/lib/iteration-types";
import { saveIterationAction } from "./actions";
import { IterationDialog } from "./iteration-ui";
import styles from "./iterations.module.css";

function emptyFeature(): IterationFeature { return { id: crypto.randomUUID(), name: "", summary: "", change: "added" }; }
export function IterationEditor({ projectId, iteration, base, releases, close, saved }: { projectId: string; iteration: IterationView | null; base: IterationView | null; releases: IterationView[]; close: () => void; saved: () => void }) {
  const [features, setFeatures] = useState<IterationFeature[]>(() => iteration?.features.length ? iteration.features : [emptyFeature()]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function update(id: string, patch: Partial<IterationFeature>) { setFeatures(current => current.map(feature => feature.id === id ? { ...feature, ...patch } : feature)); }
  function submit(data: FormData) {
    data.set("features", JSON.stringify(features));
    startTransition(async () => {
      setError("");
      try { const result = await saveIterationAction(data); if ("error" in result) setError(result.error); else saved(); }
      catch { setError("保存失败，请检查网络后重试"); }
    });
  }
  const moduleNames = [...new Set(releases.flatMap(version => version.features.map(feature => feature.name)))];
  return <IterationDialog title={iteration ? "调整本版范围" : "规划下一版"} close={close} busy={pending}>
    <form className={styles.editorForm} onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
      <input type="hidden" name="projectId" value={projectId} />
      {iteration && <><input type="hidden" name="iterationId" value={iteration.id} /><input type="hidden" name="updatedAt" value={iteration.updatedAt} /></>}
      <fieldset disabled={pending} className={styles.formFields}>
        <p className={styles.muted}>围绕用户能感知的功能定义这一版，例如“团队协作”“成果展示”。</p>
        <div className={styles.formPair}><label>版本号<input autoFocus name="version" required maxLength={40} className="ac-field" placeholder="如 v1.2.0" defaultValue={iteration?.version} /></label><label>版本主题<input name="title" required maxLength={120} className="ac-field" placeholder="如 让团队协作更顺畅" defaultValue={iteration?.title} /></label></div>
        <label>基于哪个版本<select name="baseIterationId" className="ac-field" defaultValue={iteration?.baseIterationId ?? base?.id ?? ""}><option value="">首版 / 独立规划</option>{releases.map(version => <option key={version.id} value={version.id}>{version.version} · {version.title}</option>)}</select></label>
        <label>本版目标<textarea name="goal" maxLength={5000} className="ac-field" rows={3} defaultValue={iteration?.goal} placeholder="这一版希望让用户多做成什么？" /></label>
        <div className={styles.formPair}><label>计划开始<input name="startDate" type="date" className="ac-field" defaultValue={iteration?.startDate ?? ""} /></label><label>计划交付<input name="endDate" type="date" className="ac-field" defaultValue={iteration?.endDate ?? ""} /></label></div>
        <section className={styles.moduleEditor} aria-label="本版功能变化">
          <div className={styles.moduleEditorHeading}><h4>本版功能变化</h4><span>模块级描述</span></div>
          <datalist id="iteration-module-names">{moduleNames.map(name => <option key={name} value={name} />)}</datalist>
          {features.map((feature, index) => <div key={feature.id} className={styles.moduleEditorRow}>
            <div className={styles.moduleEditorTop}><span className={styles.moduleIndex}>{String(index + 1).padStart(2, "0")}</span><label className="sr-only" htmlFor={`change-${feature.id}`}>模块 {index + 1} 变化类型</label><select id={`change-${feature.id}`} className="ac-field" value={feature.change} onChange={event => update(feature.id, { change: event.target.value as IterationFeature["change"] })}>{FEATURE_CHANGES.map(change => <option key={change} value={change}>{FEATURE_CHANGE_LABELS[change]}</option>)}</select><button type="button" className="ac-btn-ghost" aria-label={`移除模块 ${index + 1}`} onClick={() => setFeatures(current => current.filter(item => item.id !== feature.id))}>移除</button></div>
            <label>模块名称<input required maxLength={60} list="iteration-module-names" className="ac-field" value={feature.name} onChange={event => update(feature.id, { name: event.target.value })} placeholder="如 团队协作" /></label>
            <label>用户可见的变化<textarea required maxLength={500} className="ac-field" rows={2} value={feature.summary} onChange={event => update(feature.id, { summary: event.target.value })} placeholder="如 团队成员可以共享项目资料，交接时能直接找到所需背景。" /></label>
          </div>)}
          <button type="button" disabled={features.length >= 30} className={styles.addModule} onClick={() => setFeatures(current => [...current, emptyFeature()])}>＋ 添加功能模块</button>
        </section>
      </fieldset>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.formFooter}><button type="button" disabled={pending} onClick={close} className="ac-btn-ghost">取消</button><button disabled={pending} className="ac-btn">{pending ? "保存中…" : iteration ? "保存本版范围" : "保存版本规划"}</button></div>
    </form>
  </IterationDialog>;
}
