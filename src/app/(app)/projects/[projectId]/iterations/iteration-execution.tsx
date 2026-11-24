"use client";

import { useState, useTransition } from "react";
import type { IterationView } from "@/lib/iteration-types";
import { saveIterationExecutionAction } from "./actions";
import styles from "./iterations.module.css";

export function IterationExecution({ projectId, iteration, canManage, dirty, saved }: { projectId: string; iteration: IterationView; canManage: boolean; dirty: () => void; saved: () => void }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(data: FormData) {
    startTransition(async () => {
      setError("");
      try { const result = await saveIterationExecutionAction(data); if ("error" in result) setError(result.error); else saved(); }
      catch { setError("保存失败，请检查网络后重试"); }
    });
  }
  if (!canManage) return <div className={styles.executionReadOnly}>
    <section><h4>实施与推进</h4><p>{iteration.executionNotes || "尚未记录推进情况。"}</p></section><section><h4>验证结果</h4><p>{iteration.validationNotes || "尚未记录验证结果。"}</p></section><section><h4>版本说明</h4><p>{iteration.releaseNotes || "尚未填写版本说明。"}</p></section>
    {iteration.releaseUrl && <a href={iteration.releaseUrl} target="_blank" rel="noreferrer" className={styles.textLink}>查看版本成果 ↗</a>}
  </div>;
  return <form onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }} onChange={dirty}>
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="iterationId" value={iteration.id} /><input type="hidden" name="updatedAt" value={iteration.updatedAt} />
    <fieldset disabled={pending} className={styles.formFields}>
      <label>实施与推进<span className={styles.fieldHint}>记录本轮采用的方案、已做的调整，以及还需要解决的问题。</span><textarea name="executionNotes" maxLength={10000} rows={4} className="ac-field" defaultValue={iteration.executionNotes} placeholder="当前做到哪里？哪些方案已经确定？下一步如何推进？" /></label>
      <div className={styles.deliveryGrid}>
        <label>验证结果<span className={styles.fieldHint}>从使用者视角确认这些模块已经可用。</span><textarea name="validationNotes" maxLength={5000} rows={4} className="ac-field" defaultValue={iteration.validationNotes} placeholder="验证了哪些使用场景，结果如何？还存在哪些限制？" /></label>
        <label>发布说明<span className={styles.fieldHint}>发布后作为这一版的交付记录保留。</span><textarea name="releaseNotes" maxLength={10000} rows={4} className="ac-field" defaultValue={iteration.releaseNotes} placeholder="这一版最终带来了哪些变化？" /></label>
      </div>
      <label>版本成果链接 <span className={styles.optional}>选填</span><input name="releaseUrl" type="url" maxLength={2000} className="ac-field" defaultValue={iteration.releaseUrl} placeholder="演示地址、发布页或成果文档链接" /></label>
    </fieldset>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.executionFooter}><span>推进记录保存后，可继续补充。</span><button className="ac-btn" disabled={pending}>{pending ? "保存中…" : "保存推进与验证"}</button></div>
  </form>;
}
