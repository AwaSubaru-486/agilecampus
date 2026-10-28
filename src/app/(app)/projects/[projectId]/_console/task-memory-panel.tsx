"use client";

import { useEffect, useRef, useState } from "react";
import { buildTaskMemoryLink } from "../../../../../../shared/task-memory/links";
import { compareTaskMemories, exactMemoryParent, memoryParentCandidates, previewTaskMemory, renderTaskMemoryContext, type MemoryPreview, type TaskMemoryVersionView } from "@/lib/task-memory-view";
import { useMemoryContinuation } from "./use-memory-continuation";
import { continuationLabels } from "../../../../../../shared/task-memory/continuation-status";

export function TaskMemoryPanel({ projectId, taskId, canWrite, onContinueInWeb, preferredVersionId }: { projectId: string; taskId: string; canWrite: boolean; onContinueInWeb?: (version: TaskMemoryVersionView) => void; preferredVersionId?: string | null }) {
  const [versions, setVersions] = useState<TaskMemoryVersionView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<MemoryPreview | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileError, setFileError] = useState("");
  const [consent, setConsent] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const continuation = useMemoryContinuation(projectId, taskId);
  const syncBaseline = useRef<string | null | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const saveTrigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileEpoch = useRef(0);
  const endpoint = `/api/projects/${projectId}/tasks/${taskId}/memory`;
  const selected = versions.find((item) => item.id === (selectedId ?? preferredVersionId)) ?? versions[0];

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法加载任务记忆");
      if (!Array.isArray(data.versions)) throw new Error("记忆列表格式错误，请重试");
      if (controller.signal.aborted) return;
      setVersions(data.versions); setError("");
      if (syncBaseline.current !== undefined && data.versions.length && data.versions[0].id !== syncBaseline.current) {
        setSelectedId(data.versions[0].id);
        syncBaseline.current = undefined; setWaiting(false); setNotice("工作记忆已同步到此任务"); dialog.current?.close();
      }
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "无法加载任务记忆"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, reload]);

  useEffect(() => {
    if (!waiting) return;
    const interval = setInterval(() => setReload((value) => value + 1), 4000);
    const timeout = setTimeout(() => {
      clearInterval(interval); setWaiting(false); syncBaseline.current = undefined;
      setNotice("尚未收到新记忆。请在 VS Code 中完成确认，再点击刷新。");
    }, 60000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [waiting]);

  function openSave() {
    fileEpoch.current += 1;
    if (fileInput.current) fileInput.current.value = "";
    setFileError(""); setPreview(null); setFileContent(""); setConsent(false);
    dialog.current?.showModal();
  }
  function openVsCode(action: "publish" | "continue") {
    if (action === "continue") { if (selected) void continuation.start(selected.id); return; }
    try {
      const link = buildTaskMemoryLink({ action, serverOrigin: window.location.origin, projectId, taskId });
      window.location.assign(link);
      setNotice("已请求打开 VS Code，请在插件中核对并确认；此时尚未启动 Agent。");
      if (action === "publish") { syncBaseline.current = versions[0]?.id ?? null; setWaiting(true); }
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "无法打开 VS Code"); }
  }
  async function chooseFile(file?: File) {
    const epoch = ++fileEpoch.current;
    setFileError(""); setPreview(null); setFileContent(""); setConsent(false);
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("文件超过 2 MiB，请重新整理后导出");
      const text = await file.text();
      if (epoch !== fileEpoch.current) return;
      let value: unknown; try { value = JSON.parse(text); } catch { throw new Error("文件不是有效 JSON，请选择插件导出的文件"); }
      setPreview(previewTaskMemory(value, projectId, taskId)); setFileContent(text);
    } catch (failure) { if (epoch === fileEpoch.current) setFileError(failure instanceof Error ? failure.message : "无法读取文件"); }
  }
  async function save() {
    if (!preview || !consent || saving) return;
    setSaving(true); setFileError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: fileContent });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败，请重试");
      setSelectedId(result.id); setReload((value) => value + 1); setNotice("工作记忆已保存，项目成员可以查看和接续"); dialog.current?.close();
    } catch (failure) { setFileError(failure instanceof Error ? failure.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  async function copyContext() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(renderTaskMemoryContext(selected)); setNotice("已复制接续上下文，请交给你的 Agent 核对代码后继续"); }
    catch { setNotice("浏览器未允许复制，请使用“下载记忆”后在插件导入"); }
  }
  function download() {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(selected.payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `task-memory-r${selected.revision}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const material = selected?.payload.material;
  const parentVersions = selected ? memoryParentCandidates(selected, versions) : [];
  const exactParent = selected ? exactMemoryParent(selected, versions) : undefined;
  const executionVersion = versions.find((version) => version.id === continuation.record?.versionId);
  const baseline = versions.find((version) => version.id === comparisonId && version.id !== selected?.id);
  const changes = selected && baseline ? compareTaskMemories(selected, baseline) : [];
  return (
    <section aria-labelledby={`task-memory-${taskId}`} className="border-b border-stroke px-6 py-5" data-testid="task-memory-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`task-memory-${taskId}`} className="text-sm font-semibold text-ink">当前工作记忆</h3>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && <button ref={saveTrigger} className="ac-btn-ghost !min-h-9 !text-xs" onClick={openSave}>保存断点</button>}
          <button className="ac-btn !min-h-9 !text-xs" disabled={!selected || Boolean(error) || !onContinueInWeb && (!continuation.ready || continuation.pending || continuation.active)} onClick={() => {
            if (onContinueInWeb && selected) { onContinueInWeb(selected); setNotice(`已选择记忆 r${selected.revision}，将在发送下一条消息时交给网页 Agent`); }
            else openVsCode("continue");
          }}>{onContinueInWeb ? "载入记忆继续对话" : continuation.pending ? "正在发起接续…" : continuation.active ? "接续处理中" : "在 VS Code 继续工作"}</button>
          <button type="button" className="ac-btn-ghost !min-h-9 !text-xs" onClick={() => setReload((value) => value + 1)} aria-label="刷新工作记忆">刷新</button>
        </div>
      </div>
      {notice && <p role="status" className="mt-3 text-xs leading-relaxed text-ink-2">{notice}</p>}
      {continuation.record && <div className="mt-3 border-y border-stroke py-3 text-xs" aria-label="插件接续进度">
        <p role="status" className="font-medium text-ink">{continuation.waitingExpired ? "插件未接收，请重新发起接续" : continuationLabels[continuation.record.state]}</p>
        <p className="mt-1 text-ink-2">接续使用：{executionVersion ? `${executionVersion.title} / r${executionVersion.revision}` : `记忆 ${continuation.record.versionId.slice(0, 8)}（不在当前列表中）`}</p>
        <p className="mt-1 text-ink-2">{new Date(continuation.record.updatedAt).toLocaleTimeString("zh-CN")}{continuation.record.attemptId ? ` · 执行 ${continuation.record.attemptId.slice(0, 8)}` : ""}</p>
        {executionVersion && executionVersion.id !== selected?.id && <button className="mt-1 min-h-9 underline underline-offset-4" onClick={() => setSelectedId(executionVersion.id)}>查看接续使用的版本</button>}
        {continuation.paused && <p className="mt-2 text-ink-2">自动刷新已暂停。可刷新查看结果；未收到回执不代表 Agent 已停止。</p>}
        <div className="mt-2 flex flex-wrap gap-x-4">
          {continuation.record.state === "waiting" && !continuation.waitingExpired && <button className="min-h-9 underline underline-offset-4" onClick={() => continuation.open()}>重新打开 VS Code</button>}
          <button className="min-h-9 underline underline-offset-4" onClick={continuation.refresh}>刷新接续进度</button>
          {continuation.record.attemptId && ["finished", "failed"].includes(continuation.record.state) && <button className="min-h-9 underline underline-offset-4" onClick={() => {
            try {
              window.location.assign(buildTaskMemoryLink({ action: "review", serverOrigin: window.location.origin, projectId, taskId, attemptId: continuation.record!.attemptId! }));
              setNotice("请在执行本次会话的 VS Code 工作区核对并整理记忆。审核接受后，用“保存断点”同步到此任务。");
            } catch { setNotice("无法打开会话整理，请安装新版插件后重试。"); }
          }}>整理本次会话为新断点</button>}
          <details><summary className="cursor-pointer py-2 text-ink-2">接续记录</summary><ol className="space-y-2 py-2">{continuation.record.events.map((event, index) => <li key={index}>{new Date(event.at).toLocaleTimeString("zh-CN")}　{continuationLabels[event.state]}</li>)}</ol></details>
        </div>
      </div>}
      {continuation.error && <p role="alert" className="mt-3 text-xs text-risk">{continuation.error}<button className="ml-3 min-h-9 underline" onClick={continuation.refresh}>重试读取</button></p>}
      {error ? <div role="alert" className="mt-3 text-sm text-risk">{error}<button className="ml-3 underline" onClick={() => setReload((value) => value + 1)}>重试</button></div>
        : loading ? <p role="status" className="mt-4 text-sm text-ink-2">正在读取工作记忆…</p>
        : material && selected ? <>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            <span>正在查看：{selected.title} / r{selected.revision}</span><span>{selected.creatorName ?? "项目成员"}</span>
            <time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString("zh-CN")}</time>
            <span>代码 <code>{material.baseSha.slice(0, 10)}</code></span>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <MemoryRow label="已完成" items={material.completed} empty="未记录完成项" />
            <MemoryRow label="当前阻塞" items={material.blockers} empty="未记录阻塞" />
            <MemoryRow label="已失败方法" items={material.rejectedApproaches} empty="未记录失败方法" />
            <MemoryRow label="下一步" items={material.nextActions} empty="未记录下一步，接续前需核对任务要求" />
          </dl>
          <details className="mt-4 border-t border-stroke pt-3">
            <summary className="cursor-pointer text-xs text-ink-2">接班核对要求</summary>
            <p className="mt-2 text-xs text-ink-2">接续时会将以下要求交给 Agent，实际回复在对应会话中查看。</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink">
              <li>确认已继承的进度与记忆版本。</li>
              <li>核对当前代码、阻塞及历史测试。</li>
              <li>说明失败方案与重试条件。</li>
              <li>给出第一项行动和验证方式。</li>
            </ol>
          </details>
          {versions.length > 1 && <details className="mt-3 border-t border-stroke pt-3">
            <summary className="cursor-pointer text-xs text-ink-2">比较记忆变化</summary>
            {exactParent && <button className="mt-2 min-h-9 text-xs text-ink underline" onClick={() => setComparisonId(exactParent.id)}>与继承的版本比较</button>}
            <label className="mt-3 block text-xs text-ink-2" htmlFor={`memory-baseline-${taskId}`}>对比基准</label>
            <select id={`memory-baseline-${taskId}`} value={baseline?.id ?? ""} onChange={(event) => setComparisonId(event.target.value)} className="mt-2 min-h-10 w-full border border-stroke bg-panel px-3 text-sm text-ink">
              <option value="">选择一个断点</option>
              {versions.filter((version) => version.id !== selected.id).map((version) => <option key={version.id} value={version.id}>{version.title} / r{version.revision} / {version.creatorName ?? "项目成员"} / {new Date(version.createdAt).toLocaleString("zh-CN")} / {version.id.slice(0, 8)}</option>)}
            </select>
            {baseline && <div className="mt-3 space-y-3" aria-live="polite">
              <p className="text-xs text-ink-2">相对所选基准的文字变化；移出记录不代表问题已解决。</p>
              {changes.length ? changes.map((change) => <div key={change.field} className="border-t border-stroke pt-3">
                <h4 className="text-sm font-medium text-ink">{change.label}</h4>
                <dl className="mt-2 space-y-2 text-sm">
                  {change.added.length > 0 && <MemoryRow label="新增记录" items={change.added} />}
                  {change.removed.length > 0 && <MemoryRow label="移出记录" items={change.removed} />}
                </dl>
              </div>) : <p className="text-sm text-ink-2">任务记忆条目没有文字变化。</p>}
              {material.baseSha !== baseline.payload.material.baseSha && <p className="text-xs text-ink-2">代码基线变化：<code>{baseline.payload.material.baseSha.slice(0, 10)}</code> → <code>{material.baseSha.slice(0, 10)}</code></p>}
            </div>}
          </details>}
          <div className="mt-4 border-t border-stroke pt-3 text-xs text-ink-2" aria-label="记忆继承来源">
            <p>来源会话 <code>{selected.payload.memory.sessionKey.slice(0, 8)}</code></p>
            {selected.payload.memory.parentReference ? <>
              <p className="mt-2">继承版本：<code>{selected.payload.memory.parentReference.memoryId.slice(0, 8)}</code> / r{selected.payload.memory.parentReference.revision}</p>
              {exactParent ? <button className="min-h-9 underline underline-offset-4" onClick={() => setSelectedId(exactParent.id)}>查看继承的版本（内容校验匹配）</button> : <p className="mt-1">当前列表中没有内容校验匹配的父版本，无法确认来源内容。</p>}
            </> : selected.payload.memory.parentMemoryId ? <>
              <p className="mt-2">继承自记忆 <code>{selected.payload.memory.parentMemoryId.slice(0, 8)}</code>；未记录父版本修订号。</p>
              {parentVersions.length ? <div className="mt-1 flex flex-wrap gap-x-4">{parentVersions.map((parent) => <button key={parent.id} className="min-h-9 underline underline-offset-4" onClick={() => setSelectedId(parent.id)}>查看父记忆：{parent.title} / r{parent.revision}</button>)}</div> : <p className="mt-1">父记忆不在当前列表中，暂不可查看。</p>}
            </> : <p className="mt-2">未记录继承来源</p>}
          </div>
          {material.dirtyExcluded && <p className="mt-3 text-xs text-caution">此版本未包含发送端的未提交代码，接续前需补齐。</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {canWrite && <button className="min-h-9 text-ink-2 underline underline-offset-4" onClick={() => window.dispatchEvent(new CustomEvent("agilecampus:request-help", { detail: { projectId, taskId, versionId: selected.id } }))}>带此断点求助</button>}
            {onContinueInWeb && <button disabled={!continuation.ready || continuation.pending || continuation.active} onClick={() => openVsCode("continue")} className="min-h-9 text-ink-2 underline underline-offset-4 disabled:opacity-50">{continuation.active ? "插件接续处理中" : "在 VS Code 继续工作"}</button>}
            <button onClick={copyContext} className="min-h-9 text-ink-2 underline underline-offset-4">复制接续上下文</button>
            <button onClick={download} className="min-h-9 text-ink-2 underline underline-offset-4">下载记忆</button>
            <details className="w-full">
              <summary className="w-fit cursor-pointer py-2 text-ink-2">完整记忆与来源</summary>
              <dl className="mt-2 space-y-3 text-sm">
                <MemoryRow label="目标" items={material.goal} /><MemoryRow label="约束" items={material.constraints} />
                <MemoryRow label="关键决策" items={material.decisions} />
                <MemoryRow label="待完成" items={material.remaining} />
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-ink-2">来源事件 {material.sourceRange.from}–{material.sourceRange.to}；缺口 {material.sourceRange.gaps.length}；未进入提炼 {material.sourceRange.omittedEventIds.length}；截断 {material.sourceRange.truncatedEventIds.length}。原始对话正文未上传。</p>
              <p className="mt-2 text-xs text-ink-2">历史测试 {material.tests.length} 条，当前代码及测试结果由插件在接续时核对。</p>
            </details>
          </div>
          {versions.length > 1 && <details className="mt-3 border-t border-stroke pt-3">
            <summary className="cursor-pointer text-xs text-ink-2">历史断点（{versions.length}）</summary>
            <div className="mt-2 divide-y divide-stroke">{versions.map((version) => <button key={version.id} onClick={() => setSelectedId(version.id)} aria-pressed={selected.id === version.id} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-2 text-left text-xs text-ink-2 hover:text-ink">
              <span>{selected.id === version.id ? "当前查看 · " : ""}r{version.revision} · {version.title} · {version.creatorName ?? "项目成员"} · <code>{version.id.slice(0, 8)}</code></span><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time>
            </button>)}</div>
          </details>}
        </> : <div className="mt-4 text-sm leading-relaxed text-ink-2"><p>尚未保存工作记忆</p><p className="mt-1 text-xs">完成一段工作后，保存 Agent 的进度、失败方法和下一步，供自己或队友接续。</p>{canWrite && <button onClick={openSave} className="mt-3 min-h-9 text-xs font-medium text-ink underline underline-offset-4">保存第一个断点</button>}</div>}
      <dialog ref={dialog} onClose={() => saveTrigger.current?.focus()} onCancel={(event) => { if (saving) event.preventDefault(); }} className="m-auto w-[min(36rem,calc(100vw-2rem))] max-h-[85dvh] overflow-y-auto border border-stroke bg-panel p-0 text-ink backdrop:bg-black/40">
        <div className="flex items-center justify-between border-b border-stroke px-5 py-4"><h4 className="font-semibold">保存工作断点</h4><button aria-label="关闭保存断点" disabled={saving} className="ac-btn-ghost !min-h-9 !text-xs" onClick={() => dialog.current?.close()}>关闭</button></div>
        <div className="space-y-5 p-5">
          <div><h5 className="text-sm font-medium">从 VS Code 同步</h5><p className="mt-1 text-xs leading-relaxed text-ink-2">在插件中选择这项任务已确认的记忆版本。只同步整理后的记忆，不上传原始对话或代码。</p>
            <button disabled={waiting} onClick={() => openVsCode("publish")} className="ac-btn mt-3 !min-h-10 !text-xs">{waiting ? "等待插件同步…" : "打开 VS Code 选择记忆"}</button>
            {waiting && <p role="status" className="mt-2 text-xs text-ink-2">请在插件中确认同步；收到新版本后此页会自动更新。</p>}
          </div>
          <div className="border-t border-stroke pt-4"><label htmlFor={`memory-file-${taskId}`} className="block text-sm font-medium">或导入接班文件</label><p id={`memory-file-help-${taskId}`} className="mt-1 text-xs text-ink-2">选择插件导出的接班 JSON，最大 2 MiB。</p>
            <input ref={fileInput} id={`memory-file-${taskId}`} type="file" accept=".json,application/json" aria-invalid={Boolean(fileError)} aria-describedby={`memory-file-help-${taskId}${fileError ? ` memory-file-error-${taskId}` : ""}`} disabled={saving} onChange={(event) => void chooseFile(event.target.files?.[0])} className="mt-3 block w-full text-xs file:mr-3 file:border file:border-stroke file:bg-sunken file:px-3 file:py-2 file:text-ink" />
          </div>
          {preview && <div className="space-y-3 text-sm"><p className="text-xs text-ink-2">待校验版本 r{preview.revision} · 代码 <code>{preview.baseSha.slice(0, 10)}</code></p><dl className="space-y-2"><MemoryRow label="已完成" items={preview.completed} /><MemoryRow label="下一步" items={preview.nextActions} /></dl><label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={saving} className="mt-0.5" />将此版本的工作记忆保存给当前项目成员查看和接续。</label></div>}
          {fileError && <p id={`memory-file-error-${taskId}`} role="alert" className="text-sm text-risk">{fileError}</p>}
          <div className="flex justify-end gap-2"><button disabled={saving} onClick={() => dialog.current?.close()} className="ac-btn-ghost !min-h-10 !text-xs">取消</button><button disabled={!preview || !consent || saving} onClick={save} className="ac-btn !min-h-10 !text-xs">{saving ? "正在校验并保存…" : "校验并保存文件"}</button></div>
        </div>
      </dialog>
    </section>
  );
}
function MemoryRow({ label, items, empty = "未记录" }: { label: string; items: string[]; empty?: string }) {
  return <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3"><dt className="text-ink-2">{label}</dt><dd className="min-w-0 space-y-1 break-words whitespace-pre-wrap text-ink">{items.length ? items.map((item, index) => <p key={index}>{item}</p>) : <span className="text-ink-2">{empty}</span>}</dd></div>;
}
