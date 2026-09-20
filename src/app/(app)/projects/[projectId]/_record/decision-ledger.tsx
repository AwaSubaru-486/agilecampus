"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type DecisionStatus = "proposed" | "accepted" | "rejected" | "superseded";

type DecisionOption = {
  id: string;
  label: string;
  description: string | null;
  benefits: unknown;
  risks: unknown;
};

export type DecisionLedgerRow = {
  id: string;
  title: string;
  question: string;
  status: DecisionStatus;
  selectedOptionId: string | null;
  rationale: string | null;
  sourceConversationId: string | null;
  options: DecisionOption[];
  createdAt: string;
  decidedAt: string | null;
};

type DecisionLedgerProps = {
  projectId: string;
  decisions: DecisionLedgerRow[];
  canDecide: boolean;
};

const STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: "待人工确认",
  accepted: "已接受",
  rejected: "已否决",
  superseded: "已被替代",
};

const STATUS_CLASS: Record<DecisionStatus, string> = {
  proposed: "border-signal/35 bg-signal/10 text-signal",
  accepted: "border-done/35 bg-done-soft/50 text-done",
  rejected: "border-risk/35 bg-risk-soft/50 text-risk",
  superseded: "border-stroke bg-sunken text-ink-3",
};

function listValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function countByStatus(decisions: DecisionLedgerRow[], status: DecisionStatus) {
  return decisions.filter((decision) => decision.status === status).length;
}

export function DecisionLedger({ projectId, decisions: initialDecisions, canDecide }: DecisionLedgerProps) {
  const [decisions, setDecisions] = useState(initialDecisions);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialDecisions
        .filter((decision) => decision.selectedOptionId)
        .map((decision) => [decision.id, decision.selectedOptionId as string]),
    ),
  );
  const [rationales, setRationales] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialDecisions
        .filter((decision) => decision.rationale)
        .map((decision) => [decision.id, decision.rationale as string]),
    ),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  const counts = useMemo(
    () => ({
      proposed: countByStatus(decisions, "proposed"),
      accepted: countByStatus(decisions, "accepted"),
      rejected: countByStatus(decisions, "rejected"),
    }),
    [decisions],
  );

  async function resolve(decision: DecisionLedgerRow, status: "accepted" | "rejected") {
    const selectedOptionId = selectedOptions[decision.id] ?? null;
    const rationale = rationales[decision.id]?.trim() ?? "";
    if (status === "accepted" && !selectedOptionId) {
      setFeedback((current) => ({ ...current, [decision.id]: "先选择一个方案，再接受这项决策。" }));
      return;
    }
    if (!rationale) {
      setFeedback((current) => ({ ...current, [decision.id]: "请写下确认或否决的理由，方便后续复盘。" }));
      return;
    }

    setPendingId(decision.id);
    setFeedback((current) => ({ ...current, [decision.id]: "正在登记……" }));
    try {
      const response = await fetch(`/api/decisions/${decision.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          selectedOptionId: status === "accepted" ? selectedOptionId : null,
          rationale,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { decision?: Partial<DecisionLedgerRow>; error?: string };
      if (!response.ok || !payload.decision) throw new Error(payload.error ?? "登记失败，请稍后重试。");
      setDecisions((current) =>
        current.map((item) => (item.id === decision.id ? { ...item, ...payload.decision, status } : item)),
      );
      setFeedback((current) => ({
        ...current,
        [decision.id]: status === "accepted" ? "已接受，结果已写入项目记录。" : "已否决，理由已写入项目记录。",
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [decision.id]: error instanceof Error ? error.message : "登记失败，请稍后重试。",
      }));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      id="decisions"
      aria-labelledby="decision-ledger-title"
      className="overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel"
    >
      <header className="flex flex-col gap-4 border-b border-stroke bg-ground/50 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-agent">证据账本</p>
          <h2 id="decision-ledger-title" className="mt-1 font-display text-xl font-bold text-ink">
            决策记录
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-2">
            AI 可以比较方案，但最终选择由项目成员确认，并保留可复盘的理由。
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-stroke border-y border-stroke sm:min-w-[18rem]">
          <div className="px-3 py-2">
            <dt className="text-[11px] text-ink-3">待确认</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-signal">{counts.proposed}</dd>
          </div>
          <div className="px-3 py-2">
            <dt className="text-[11px] text-ink-3">已接受</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-done">{counts.accepted}</dd>
          </div>
          <div className="px-3 py-2">
            <dt className="text-[11px] text-ink-3">已否决</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-risk">{counts.rejected}</dd>
          </div>
        </dl>
      </header>

      {decisions.length === 0 ? (
        <div className="px-4 py-8 text-center sm:px-5">
          <p className="text-sm font-medium text-ink">还没有 AI 提出的决策。</p>
          <p className="mt-1 text-xs leading-5 text-ink-2">方案比较后，会在这里等待成员确认。</p>
          <Link
            href={`/projects/${projectId}?space=studio#ai-collaboration`}
            className="mt-3 inline-flex rounded-[var(--radius-control)] text-xs font-medium text-signal underline decoration-signal/30 underline-offset-4 hover:decoration-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            去协同室让 AI 比较方案 →
          </Link>
        </div>
      ) : (
        <ol className="divide-y divide-stroke">
          {decisions.map((decision) => {
            const selectedOption = decision.options.find((option) => option.id === (selectedOptions[decision.id] ?? decision.selectedOptionId));
            const isProposed = decision.status === "proposed";
            const isPending = pendingId === decision.id;
            const message = feedback[decision.id];

            return (
              <li key={decision.id} className="px-4 py-5 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[decision.status]}`}>
                        {STATUS_LABEL[decision.status]}
                      </span>
                      <span className="text-[11px] text-ink-3">提出于 {formatDate(decision.createdAt)}</span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-ink">{decision.title}</h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-2">{decision.question}</p>
                  </div>
                  {decision.sourceConversationId && <span className="shrink-0 text-[11px] text-agent">有对话依据</span>}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.7fr)]">
                  <fieldset className="space-y-2" disabled={!isProposed || !canDecide || isPending}>
                    <legend className="text-xs font-semibold text-ink-2">{isProposed ? "请选择方案" : "最终方案"}</legend>
                    {decision.options.map((option) => {
                      const benefits = listValue(option.benefits);
                      const risks = listValue(option.risks);
                      const checked = (selectedOptions[decision.id] ?? decision.selectedOptionId) === option.id;
                      return (
                        <label
                          key={option.id}
                          className={`block border-l-2 px-3 py-2.5 transition-colors ${
                            checked ? "border-signal bg-signal/5" : "border-stroke bg-sunken/30 hover:border-stroke-strong"
                          } ${isProposed && canDecide ? "cursor-pointer" : ""}`}
                        >
                          <span className="flex items-start gap-2">
                            <input
                              type="radio"
                              name={`decision-${decision.id}`}
                              value={option.id}
                              checked={checked}
                              onChange={() => setSelectedOptions((current) => ({ ...current, [decision.id]: option.id }))}
                              className="mt-0.5 accent-[var(--color-signal)]"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-ink">{option.label}</span>
                              {option.description && <span className="mt-0.5 block text-xs leading-5 text-ink-2">{option.description}</span>}
                            </span>
                          </span>
                          {(benefits.length > 0 || risks.length > 0) && (
                            <span className="ml-6 mt-2 grid gap-1 text-[11px] leading-5 sm:grid-cols-2">
                              {benefits.length > 0 && (
                                <span className="text-done">收益：{benefits.join("、")}</span>
                              )}
                              {risks.length > 0 && <span className="text-risk">风险：{risks.join("、")}</span>}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </fieldset>

                  <div className="border-l border-stroke pl-3 lg:pl-4">
                    <label htmlFor={`decision-rationale-${decision.id}`} className="text-xs font-semibold text-ink-2">
                      {isProposed ? "确认理由" : "登记理由"}
                    </label>
                    <textarea
                      id={`decision-rationale-${decision.id}`}
                      value={rationales[decision.id] ?? ""}
                      onChange={(event) => setRationales((current) => ({ ...current, [decision.id]: event.target.value }))}
                      disabled={!isProposed || !canDecide || isPending}
                      rows={4}
                      maxLength={2000}
                      placeholder={isProposed ? "为什么选择或否决这个方案？" : "该决策已经登记。"}
                      className="ac-field mt-2 min-h-24 w-full resize-y text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                    {isProposed && canDecide && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => resolve(decision, "accepted")}
                          className="ac-btn-ink ac-pressable rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-wait disabled:opacity-60"
                        >
                          接受方案
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => resolve(decision, "rejected")}
                          className="ac-btn rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold text-risk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risk disabled:cursor-wait disabled:opacity-60"
                        >
                          否决方案
                        </button>
                      </div>
                    )}
                    {message && (
                      <p aria-live="polite" className={`mt-2 text-xs leading-5 ${message.includes("失败") || message.includes("请") || message.includes("先") ? "text-risk" : "text-ink-2"}`}>
                        {message}
                      </p>
                    )}
                  </div>
                </div>

                {selectedOption && !isProposed && (
                  <p className="mt-3 border-t border-stroke pt-3 text-xs text-ink-2">
                    记录方案：<span className="font-medium text-ink">{selectedOption.label}</span>
                    {decision.decidedAt && <span className="ml-2 text-ink-3">· {formatDate(decision.decidedAt)} 登记</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!canDecide && decisions.some((decision) => decision.status === "proposed") && (
        <p className="border-t border-stroke bg-ground/40 px-4 py-3 text-xs text-ink-2 sm:px-5">
          你可以查看方案与依据；决策确认需要项目成员完成。
        </p>
      )}
      <p className="border-t border-stroke px-4 py-3 text-[11px] leading-5 text-ink-3 sm:px-5">
        方案确认、否决与理由都会写入活动记录，后续可以回到过程流复盘。
      </p>
    </section>
  );
}
