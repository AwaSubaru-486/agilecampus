"use client";

import { useActionState } from "react";
import { createMilestoneAction, type FormState } from "./actions";

type Milestone = {
  id: string;
  title: string;
  targetDate: string | null;
  status: string;
};

export function MilestoneSection({
  projectId,
  milestones,
  isAdmin,
}: {
  projectId: string;
  milestones: Milestone[];
  isAdmin: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createMilestoneAction,
    null,
  );

  return (
    <section className="ac-card p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.14em] text-accent">MILESTONES</p>
          <h2 className="mt-1 font-display text-lg font-bold text-ink">阶段节点</h2>
        </div>
        {isAdmin && (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input name="title" placeholder="新增节点" className="ac-field w-36 text-sm" />
            <input type="date" name="targetDate" className="ac-field w-auto text-sm" />
            <button disabled={pending} className="ac-btn px-3 py-2 text-sm">添加</button>
            {state?.error && <p className="basis-full text-right text-xs text-high">{state.error}</p>}
          </form>
        )}
      </div>
      <ul className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {milestones.map((m) => (
          <li key={m.id} className="flex shrink-0 items-center gap-2 rounded-xl bg-sunken px-3 py-2 text-sm text-ink">
            <span className="size-1.5 rounded-full bg-accent" />
            <span className="font-medium">{m.title}</span>
            {m.targetDate && (
              <span className="text-xs text-ink-faint">{m.targetDate}</span>
            )}
          </li>
        ))}
        {milestones.length === 0 && (
          <li className="text-sm text-ink-faint">还没有阶段节点，先确定第一次可展示成果。</li>
        )}
      </ul>
    </section>
  );
}
