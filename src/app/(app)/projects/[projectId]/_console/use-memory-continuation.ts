"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildTaskMemoryLink } from "../../../../../../shared/task-memory/links";
import { continuationReceiptQuietMs, continuationTiming, continuationWaitingLimitMs, isContinuationTerminal, type ContinuationView } from "../../../../../../shared/task-memory/continuation-status";

export function useMemoryContinuation(projectId: string, taskId: string) {
  const [record, setRecord] = useState<ContinuationView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const lock = useRef(false);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const requestKey = useRef<{ id: string; versionId: string } | null>(null);
  const endpoint = `/api/projects/${projectId}/tasks/${taskId}/memory/continuations`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const currentGeneration = generation.current;
    const sequence = ++refreshSequence.current;
    const isCurrent = () => !signal?.aborted && !lock.current && generation.current === currentGeneration && refreshSequence.current === sequence;
    try {
      const response = await fetch(endpoint, { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取接续进度");
      if (isCurrent()) { setRecord(data.continuation); setError(""); setClock(Date.now()); setReady(true); }
    } catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : "无法读取接续进度"); }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);
  const active = record !== null && !isContinuationTerminal(record.state);
  useEffect(() => {
    if (!active || !record) return;
    const deadline = record.state === "waiting" ? Date.parse(record.createdAt) + continuationWaitingLimitMs : Date.parse(record.updatedAt) + continuationReceiptQuietMs;
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [active, record]);
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
  const { waitingExpired, receiptQuiet } = continuationTiming(record, clock);
  async function start(versionId: string) {
    if (lock.current || !ready || active && !continuationTiming(record, Date.now()).waitingExpired) return;
    lock.current = true; generation.current++; setPending(true); setError("");
    try {
      if (active) {
        // Polling may have paused before the plugin acknowledged the old request.
        const latest = await fetch(endpoint, { cache: "no-store" });
        const snapshot = await latest.json();
        if (!latest.ok) throw new Error(snapshot.error || "无法确认上一条接续状态，请先刷新进度");
        const fresh: ContinuationView | null = snapshot.continuation;
        setRecord(fresh); setClock(Date.now());
        if (fresh && !isContinuationTerminal(fresh.state) && !continuationTiming(fresh, Date.now()).waitingExpired) {
          setPaused(false);
          return;
        }
      }
      // An ambiguous POST response is retried with the same id, never a second request.
      if (!requestKey.current || requestKey.current.versionId !== versionId) requestKey.current = { id: crypto.randomUUID(), versionId };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestKey.current) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法创建接续请求");
      setRecord(data); setClock(Date.now()); setPaused(false); requestKey.current = null;
      open(data);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "无法发起接续"); }
    finally { lock.current = false; setPending(false); }
  }
  function open(value = record) {
    if (!value || value.state !== "waiting" || Date.now() - Date.parse(value.createdAt) >= continuationWaitingLimitMs) return;
    try { window.location.assign(buildTaskMemoryLink({ action: "continue", serverOrigin: window.location.origin,
      projectId, taskId, versionId: value.versionId, requestId: value.id })); }
    catch { setError("无法打开 VS Code，请安装新版插件后重试"); }
  }
  return { record, pending, error, paused, waitingExpired, receiptQuiet, active: active && !waitingExpired, ready, start, open, refresh: () => { setPaused(false); void refresh(); } };
}
