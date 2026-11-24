"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { listTaskNotifications } from "@/lib/task-notifications";

type Notice = Awaited<ReturnType<typeof listTaskNotifications>>[number];

export function TaskNotificationInbox({ userId }: { userId: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dismissed = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const notice = notices[0];

  useEffect(() => {
    let disposed = false;
    let fetching = false;
    const controller = new AbortController();
    async function refresh() {
      if (document.visibilityState !== "visible" || fetching) return;
      fetching = true;
      try {
        const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
        if (response.ok) {
          const rows: Notice[] = await response.json();
          if (!disposed) setNotices(rows.filter(row => !dismissed.current.has(row.id)));
        }
      } catch { /* A network outage leaves existing alerts visible; the next poll retries. */ }
      finally { fetching = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId]);

  useEffect(() => {
    if (notice && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [notice]);

  async function acknowledge(openTask: boolean) {
    if (!notice || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: notice.id }) });
      if (!response.ok) throw new Error("确认没有成功，请重试。通知会保留。");
      dismissed.current.add(notice.id);
      setNotices(current => current.filter(row => row.id !== notice.id));
      if (openTask) router.push(`/projects/${notice.projectId}?space=work&task=${notice.taskId}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "连接中断，请重试。"); }
    finally { setBusy(false); }
  }

  if (!notice) return null;
  return <dialog ref={dialog} className="ac-handoff-dialog" aria-labelledby="handoff-notice-title" aria-describedby="handoff-notice-description"
    onCancel={event => { event.preventDefault(); void acknowledge(false); }}>
    <button type="button" className="ac-handoff-close" aria-label="关闭并确认交接通知" disabled={busy} onClick={() => void acknowledge(false)}>×</button>
    <div className="ac-handoff-content">
      <p className="text-sm font-semibold tracking-widest text-signal">任务交接：{notice.projectName}</p>
      <span className="ac-handoff-symbol" aria-hidden>↗</span>
      <h2 id="handoff-notice-title" className="text-3xl font-semibold tracking-tight sm:text-5xl">轮到你接棒了</h2>
      <p id="handoff-notice-description" className="mt-6 max-w-xl text-base leading-8 text-ink-3">「{notice.sourceTitle}」已通过验收。接下来由你负责：</p>
      <p className="mt-4 text-xl font-semibold sm:text-2xl">{notice.taskTitle}</p>
      <p className="mt-5 text-sm text-ink-3">打开任务查看完成要求，再决定何时开始。关闭提醒不会改变任务状态。</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" className="ac-btn" disabled={busy} onClick={() => void acknowledge(true)}>{busy ? "正在确认…" : "查看我的任务 →"}</button>
        <button type="button" className="ac-btn-ghost" disabled={busy} onClick={() => void acknowledge(false)}>我知道了，稍后处理</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      {notices.length > 1 && <p className="mt-5 text-xs text-ink-3">还有 {notices.length - 1} 条交接提醒，确认后继续查看。</p>}
    </div>
  </dialog>;
}
