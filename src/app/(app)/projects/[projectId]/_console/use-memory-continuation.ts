"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildTaskMemoryLink } from "../../../../../../shared/task-memory/links";
import { isContinuationTerminal, type ContinuationView } from "../../../../../../shared/task-memory/continuation-status";

export function useMemoryContinuation(projectId: string, taskId: string) {
  const [record, setRecord] = useState<ContinuationView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const lock = useRef(false);
  const generation = useRef(0);
  const requestKey = useRef<{ id: string; versionId: string } | null>(null);
  const endpoint = `/api/projects/${projectId}/tasks/${taskId}/memory/continuations`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const currentGeneration = generation.current;
    try {
      const response = await fetch(endpoint, { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取接续进度");
      if (!signal?.aborted && !lock.current && generation.current === currentGeneration) { setRecord(data.continuation); setError(""); setClock(Date.now()); setReady(true); }
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "无法读取接续进度"); }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);
  const active = record !== null && !isContinuationTerminal(record.state);
  useEffect(() => {
    if (!active || paused) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      await refresh(controller.signal);
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    const limit = setTimeout(() => setPaused(true), 120_000);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); clearTimeout(limit); };
  }, [active, paused, refresh]);
  const waitingExpired = record?.state === "waiting" && clock - Date.parse(record.createdAt) > 10 * 60_000;
  async function start(versionId: string) {
    if (lock.current || !ready || active && !waitingExpired) return;
    lock.current = true; generation.current++; setPending(true); setError("");
    try {
      // An ambiguous POST response is retried with the same id, never a second request.
      if (!requestKey.current || requestKey.current.versionId !== versionId) requestKey.current = { id: crypto.randomUUID(), versionId };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestKey.current) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法创建接续请求");
      setRecord(data); setPaused(false); requestKey.current = null;
      open(data);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "无法发起接续"); }
    finally { lock.current = false; setPending(false); }
  }
  function open(value = record) {
    if (!value || value.state !== "waiting" || Date.now() - Date.parse(value.createdAt) > 10 * 60_000) return;
    try { window.location.assign(buildTaskMemoryLink({ action: "continue", serverOrigin: window.location.origin,
      projectId, taskId, versionId: value.versionId, requestId: value.id })); }
    catch { setError("无法打开 VS Code，请安装新版插件后重试"); }
  }
  return { record, pending, error, paused, waitingExpired, active: active && !waitingExpired, ready, start, open, refresh: () => { setPaused(false); void refresh(); } };
}
