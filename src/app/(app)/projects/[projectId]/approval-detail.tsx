"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApprovalListItem } from "@/lib/approval";

type ApprovalStatus = ApprovalListItem["status"];

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "待确认",
  executing: "执行中",
  executed: "已执行",
  rejected: "已驳回",
  failed: "执行失败",
};

const STATUS_TONE: Record<ApprovalStatus, string> = {
  pending: "border-signal/40 bg-signal-soft/50 text-signal",
  executing: "border-warn/40 bg-warn-soft/50 text-warn",
  executed: "border-done/40 bg-done-soft/50 text-done",
  rejected: "border-stroke bg-sunken text-ink-3",
  failed: "border-risk/40 bg-risk-soft/50 text-risk",
};

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function ApprovalDetail({
  projectId,
  approval: initialApproval,
}: {
  projectId: string;
  approval: ApprovalListItem;
}) {
  const router = useRouter();
  const [approval, setApproval] = useState(initialApproval);
  const [payloadText, setPayloadText] = useState(JSON.stringify(initialApproval.payload, null, 2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const [preview, setPreview] = useState<{
    staleCount: number;
    rows: { taskId: string | null; title: string; stale: boolean; expectedUpdatedAt: string | null; currentUpdatedAt: string | null }[];
  } | null>(null);

  const canResolve = approval.canResolve !== false && (approval.status === "pending" || approval.status === "failed");
  const staleExecuting =
    approval.status === "executing" && renderedAt - new Date(approval.updatedAt).getTime() > 5 * 60 * 1000;

  useEffect(() => {
    if (approval.tool !== "update_tasks") return;
    let cancelled = false;
    fetch(`/api/approvals/${approval.id}/preview`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.preview) setPreview(data.preview);
      })
      .catch(() => {
        // 预览失败不阻断审批；最终执行仍由 commitDraft 的 CAS 再校验。
      });
    return () => {
      cancelled = true;
    };
  }, [approval.id, approval.tool]);

  async function resolve(decision: "approve" | "reject") {
    setError(null);
    let payload: unknown;
    if (decision === "approve") {
      try {
        payload = JSON.parse(payloadText);
      } catch {
        setError("JSON 格式有误，请修正后再确认");
        return;
      }
    }
    if (decision === "reject" && !note.trim()) {
      setError("驳回时请写一句原因，方便提出者修改");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/approvals/${approval.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, payload, note: note.trim() || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "审批失败");
      setApproval(data.approval);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审批失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/approvals/${approval.id}/recover`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "恢复失败");
      setApproval(data.approval);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-b border-stroke bg-ground/70 px-4 py-3" aria-label="AI 审批详情">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-agent">AI action</span>
            <h3 className="text-sm font-semibold text-ink">{approval.title}</h3>
            <span className={`border px-1.5 py-0.5 text-[11px] ${STATUS_TONE[approval.status]}`}>
              {STATUS_LABEL[approval.status]}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {approval.requestedByName ?? "已注销成员"} 提出 · {formatDate(approval.createdAt)} · {approval.tool}
          </p>
        </div>
        {approval.sourceConversationId && (
          <Link
            href={`/projects/${projectId}?space=studio&conversation=${approval.sourceConversationId}`}
            className="text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal"
          >
            查看来源会话 →
          </Link>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <label className="block text-[11px] font-medium text-ink-2">
          将要写入的结构化内容
          <textarea
            value={payloadText}
            onChange={(event) => setPayloadText(event.target.value)}
            readOnly={!canResolve}
            spellCheck={false}
            rows={Math.min(12, Math.max(5, payloadText.split("\n").length + 1))}
            className="mt-1 block w-full resize-y border border-stroke bg-panel px-2.5 py-2 font-mono text-[11px] leading-5 text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal read-only:bg-sunken"
            aria-label="审批 payload JSON"
          />
        </label>
        <div className="space-y-3 text-xs text-ink-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-ink-3">来源消息</dt>
            <dd className="truncate font-mono">{approval.sourceMessageId?.slice(0, 8) ?? "—"}</dd>
            <dt className="text-ink-3">更新时间</dt>
            <dd>{formatDate(approval.updatedAt)}</dd>
            {approval.error && <dt className="text-risk">失败原因</dt>}
            {approval.error && <dd className="text-risk">{approval.error}</dd>}
          </dl>
          {canResolve && (
            <>
              <label className="block text-[11px] font-medium text-ink-2">
                处理备注（驳回必填）
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="例如：先补充负责人和截止日"
                  className="ac-field mt-1 text-xs"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resolve("approve")}
                  className="ac-btn-ink px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {busy ? "处理中…" : approval.status === "failed" ? "修正并重试" : "确认执行"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resolve("reject")}
                  className="ac-btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  驳回
                </button>
              </div>
            </>
          )}
          {staleExecuting && (
            <div className="space-y-2 border-l-2 border-risk/50 pl-2 text-xs text-risk">
              <p>这条审批已超过 5 分钟没有心跳，业务写入状态可能未知。</p>
              <button
                type="button"
                disabled={busy}
                onClick={recover}
                className="ac-btn-ghost px-2 py-1 text-xs text-risk disabled:opacity-50"
              >
                {busy ? "处理中…" : "标记为失败并核对"}
              </button>
            </div>
          )}
          {approval.resolutionNote && (
            <p className="border-l-2 border-stroke-strong pl-2 text-ink-3">处理备注：{approval.resolutionNote}</p>
          )}
        </div>
      </div>
      {preview && preview.rows.length > 0 && (
        <div className={`mt-3 border-l-2 px-2.5 py-2 text-xs ${preview.staleCount > 0 ? "border-risk/60 bg-risk-soft/40 text-risk" : "border-done/50 bg-done-soft/30 text-ink-2"}`}>
          <p className="font-medium">
            {preview.staleCount > 0
              ? `${preview.staleCount} 项任务已发生变化，确认后会跳过这些冲突项`
              : "任务当前版本与 AI 草案一致"}
          </p>
          <ul className="mt-1.5 space-y-1 font-mono text-[10px]">
            {preview.rows.map((row) => (
              <li key={`${row.taskId ?? "missing"}-${row.expectedUpdatedAt ?? "none"}`} className={row.stale ? "text-risk" : "text-ink-3"}>
                {row.stale ? "冲突" : "一致"} · {row.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      {approval.canResolve === false && (
        <p className="mt-3 border-l-2 border-warn/50 bg-warn-soft/40 px-2.5 py-2 text-xs text-warn">
          {approval.permissionReason ?? "当前角色不能确认这类 AI 写操作，请转交有权限的成员。"}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs font-medium text-risk">{error}</p>}
    </section>
  );
}
