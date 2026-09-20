"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Draft = { tool: string; draft: unknown };
type Option = { id: string; name: string };
type DecisionDraftOption = {
  label?: string;
  description?: string;
  benefits?: string[];
  risks?: string[];
  evidenceRefs?: unknown;
};

type DecisionDraft = {
  title?: string;
  question?: string;
  taskId?: string | null;
  milestoneId?: string | null;
  options?: DecisionDraftOption[];
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
};

async function commit(projectId: string, tool: string, draft: unknown): Promise<string | null> {
  const res = await fetch("/api/chat/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, tool, draft }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return data.error ?? "落库失败";
  if (Array.isArray(data.conflicts) && data.conflicts.length > 0)
    return `有 ${data.conflicts.length} 项因他人改动未落库，请刷新后重试`;
  return null;
}

function CardShell({
  title,
  onConfirm,
  children,
}: {
  title: string;
  onConfirm: () => Promise<string | null>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  if (state === "done")
    return (
      <div className="ac-card p-2 text-xs text-done">
        {title}：已落库
      </div>
    );

  return (
    <div className="ac-card space-y-2 border-accent/30 bg-accent-soft p-2 text-sm">
      <p className="text-xs font-medium text-accent">待确认：{title}</p>
      {children}
      {err && <p role="alert" aria-live="polite" className="text-xs text-high">{err}</p>}
      <button
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          setErr(null);
          const e = await onConfirm();
          if (e) {
            setErr(e);
            setState("idle");
          } else {
            setState("done");
            router.refresh();
          }
        }}
        className="ac-btn px-2 py-1 text-xs"
      >
        {state === "pending" ? "落库中…" : "确认落库"}
      </button>
    </div>
  );
}

export function DraftCards({
  projectId,
  drafts,
  members,
  milestones,
}: {
  projectId: string;
  drafts: Draft[];
  members: Option[];
  milestones: Option[];
}) {
  return (
    <div className="mt-2 space-y-2">
      {drafts.map((d, i) => (
        <DraftCard key={i} cardId={`${d.tool}-${i}`} projectId={projectId} draft={d} members={members} milestones={milestones} />
      ))}
    </div>
  );
}

function DraftCard({
  cardId,
  projectId,
  draft,
  members,
  milestones,
}: {
  cardId: string;
  projectId: string;
  draft: Draft;
  members: Option[];
  milestones: Option[];
}) {
  const [data, setData] = useState<Record<string, unknown>>(draft.draft as Record<string, unknown>);

  if (draft.tool === "create_project") {
    const d = data as { name?: string; description?: string; startDate?: string; endDate?: string };
    return (
      <CardShell title="创建项目" onConfirm={() => commit(projectId, "create_project", d)}>
        <input
          value={d.name ?? ""}
          onChange={(e) => setData({ ...d, name: e.target.value })}
          placeholder="项目名称"
          className="ac-field text-xs"
        />
        <textarea
          value={d.description ?? ""}
          onChange={(e) => setData({ ...d, description: e.target.value })}
          placeholder="描述"
          className="ac-field text-xs"
          rows={2}
        />
        <div className="flex gap-1">
          <input type="date" value={d.startDate ?? ""} onChange={(e) => setData({ ...d, startDate: e.target.value })} className="ac-field w-auto text-xs" />
          <input type="date" value={d.endDate ?? ""} onChange={(e) => setData({ ...d, endDate: e.target.value })} className="ac-field w-auto text-xs" />
        </div>
      </CardShell>
    );
  }

  if (draft.tool === "create_milestone") {
    const d = data as { title?: string; targetDate?: string };
    return (
      <CardShell title="创建里程碑" onConfirm={() => commit(projectId, "create_milestone", d)}>
        <input
          value={d.title ?? ""}
          onChange={(e) => setData({ ...d, title: e.target.value })}
          placeholder="里程碑名称"
          className="ac-field text-xs"
        />
        <input
          type="date"
          value={d.targetDate ?? ""}
          onChange={(e) => setData({ ...d, targetDate: e.target.value || undefined })}
          className="ac-field w-auto text-xs"
        />
      </CardShell>
    );
  }

  if (draft.tool === "decompose_tasks") {
    const d = data as {
      tasks: { title: string; assigneeId?: string; priority?: string; dueDate?: string; milestoneId?: string }[];
    };
    const setTask = (idx: number, patch: object) =>
      setData({ ...d, tasks: d.tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t)) });
    return (
      <CardShell title={`拆解任务（${d.tasks.length}）`} onConfirm={() => commit(projectId, "decompose_tasks", d)}>
        {d.tasks.map((t, idx) => (
          <div key={idx} className="flex flex-wrap gap-1 border-b border-line pb-1">
            <input value={t.title} onChange={(e) => setTask(idx, { title: e.target.value })} className="ac-field flex-1 text-xs" />
            <select value={t.assigneeId ?? ""} onChange={(e) => setTask(idx, { assigneeId: e.target.value || undefined })} className="ac-field w-auto text-xs">
              <option value="">未分配</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select value={t.priority ?? "medium"} onChange={(e) => setTask(idx, { priority: e.target.value })} className="ac-field w-auto text-xs">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
            <input type="date" value={t.dueDate ?? ""} onChange={(e) => setTask(idx, { dueDate: e.target.value || undefined })} className="ac-field w-auto text-xs" />
            <button type="button" onClick={() => setData({ ...d, tasks: d.tasks.filter((_, i) => i !== idx) })} className="text-xs text-high hover:underline">
              删
            </button>
          </div>
        ))}
      </CardShell>
    );
  }

  if (draft.tool === "update_tasks") {
    const d = data as { updates: { taskId: string; updatedAt: string; patch: Record<string, unknown> }[] };
    return (
      <CardShell title={`批量变更（${d.updates.length}）`} onConfirm={() => commit(projectId, "update_tasks", d)}>
        {d.updates.map((u, idx) => (
          <div key={idx} className="border-b border-line pb-1 text-xs">
            <span className="text-ink-soft">任务 {u.taskId.slice(0, 8)}…：</span>
            <span className="text-ink">{JSON.stringify(u.patch)}</span>
          </div>
        ))}
      </CardShell>
    );
  }

  if (draft.tool === "plan_sprint") {
    const d = data as { milestoneId: string; taskIds: string[]; dueDate: string };
    return (
      <CardShell title={`排期（${d.taskIds.length} 任务）`} onConfirm={() => commit(projectId, "plan_sprint", d)}>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <select value={d.milestoneId} onChange={(e) => setData({ ...d, milestoneId: e.target.value })} className="ac-field w-auto text-xs">
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input type="date" value={d.dueDate} onChange={(e) => setData({ ...d, dueDate: e.target.value })} className="ac-field w-auto text-xs" />
          <span className="text-ink-soft">{d.taskIds.length} 个任务</span>
        </div>
      </CardShell>
    );
  }

  if (draft.tool === "create_decision") {
    const d = data as DecisionDraft;
    const options = Array.isArray(d.options) ? d.options : [];
    const setOption = (idx: number, patch: Partial<DecisionDraftOption>) =>
      setData({
        ...d,
        options: options.map((option, optionIndex) =>
          optionIndex === idx ? { ...option, ...patch } : option,
        ),
      });
    const removeOption = (idx: number) =>
      setData({ ...d, options: options.filter((_, optionIndex) => optionIndex !== idx) });
    const addOption = () =>
      setData({ ...d, options: [...options, { label: "", description: "", benefits: [], risks: [] }] });
    const save = () => {
      if (!d.title?.trim()) return Promise.resolve("请补充决策标题");
      if (!d.question?.trim()) return Promise.resolve("请补充要回答的问题");
      if (options.length === 0) return Promise.resolve("至少保留一个方案");
      if (options.some((option) => !option.label?.trim())) return Promise.resolve("每个方案都需要名称");
      return commit(projectId, "create_decision", d);
    };

    return (
      <CardShell title={`决策草案（${options.length} 个方案）`} onConfirm={save}>
        <div className="space-y-2 border-b border-line pb-2">
          <label className="block text-[11px] font-medium text-ink-soft" htmlFor={`decision-title-${projectId}-${cardId}`}>
            决策标题
            <input
              id={`decision-title-${projectId}-${cardId}`}
              value={d.title ?? ""}
              onChange={(event) => setData({ ...d, title: event.target.value })}
              placeholder="例如：首版是否引入缓存"
              className="ac-field mt-1 text-xs"
            />
          </label>
          <label className="block text-[11px] font-medium text-ink-soft" htmlFor={`decision-question-${projectId}-${cardId}`}>
            要回答的问题
            <textarea
              id={`decision-question-${projectId}-${cardId}`}
              value={d.question ?? ""}
              onChange={(event) => setData({ ...d, question: event.target.value })}
              placeholder="让成员知道这次需要确认什么"
              rows={2}
              className="ac-field mt-1 text-xs"
            />
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[11px] font-medium text-ink-soft">方案比较</legend>
          {options.map((option, idx) => (
            <div key={idx} className="border-l-2 border-signal/50 bg-panel px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span aria-hidden className="mt-2 shrink-0 font-mono text-[10px] text-ink-3">{String(idx + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <label className="sr-only" htmlFor={`decision-option-${projectId}-${cardId}-${idx}`}>
                    方案 {idx + 1} 名称
                  </label>
                  <input
                    id={`decision-option-${projectId}-${cardId}-${idx}`}
                    value={option.label ?? ""}
                    onChange={(event) => setOption(idx, { label: event.target.value })}
                    placeholder="方案名称"
                    className="ac-field text-xs"
                  />
                  <label className="sr-only" htmlFor={`decision-option-description-${projectId}-${cardId}-${idx}`}>
                    方案 {idx + 1} 说明
                  </label>
                  <textarea
                    id={`decision-option-description-${projectId}-${cardId}-${idx}`}
                    value={option.description ?? ""}
                    onChange={(event) => setOption(idx, { description: event.target.value })}
                    placeholder="说明怎么做、适用什么情况"
                    rows={2}
                    className="ac-field text-xs"
                  />
                  <div className="grid gap-1 sm:grid-cols-2">
                    <label className="sr-only" htmlFor={`decision-option-benefits-${projectId}-${cardId}-${idx}`}>
                      方案 {idx + 1} 收益
                    </label>
                    <input
                      id={`decision-option-benefits-${projectId}-${cardId}-${idx}`}
                      value={(option.benefits ?? []).join("、")}
                      onChange={(event) => setOption(idx, { benefits: splitDecisionList(event.target.value) })}
                      placeholder="收益，用顿号分隔"
                      className="ac-field text-xs"
                    />
                    <label className="sr-only" htmlFor={`decision-option-risks-${projectId}-${cardId}-${idx}`}>
                      方案 {idx + 1} 风险
                    </label>
                    <input
                      id={`decision-option-risks-${projectId}-${cardId}-${idx}`}
                      value={(option.risks ?? []).join("、")}
                      onChange={(event) => setOption(idx, { risks: splitDecisionList(event.target.value) })}
                      placeholder="风险，用顿号分隔"
                      className="ac-field text-xs"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeOption(idx)}
                  aria-label={`删除方案 ${idx + 1}`}
                  className="mt-1 shrink-0 rounded-[var(--radius-control)] px-1.5 py-1 text-xs text-ink-3 hover:text-risk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addOption}
            className="rounded-[var(--radius-control)] px-1 py-1 text-xs font-medium text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            + 增加一个方案
          </button>
        </fieldset>
        <p className="text-[11px] leading-5 text-ink-3">落库后仍是“待人工确认”，不会直接替你做决定。</p>
      </CardShell>
    );
  }

  return null;
}

function splitDecisionList(value: string) {
  return value
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
