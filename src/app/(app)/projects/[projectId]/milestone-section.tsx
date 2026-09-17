"use client";

import { useActionState } from "react";
import { createMilestoneAction, type FormState } from "./actions";

// 只负责「新建里程碑」。原先这里还兼着展示列表，那一块已交给工作现场——
// 那里的里程碑带自动记录与高光，比一串色点有用得多。
//
// 里程碑的**达成**是自动判定的（见 lib/milestone.ts），此处只管把它建出来。
export function MilestoneCreateForm({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createMilestoneAction,
    null,
  );
  if (!isAdmin) return null;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input name="title" placeholder="新增里程碑" className="ac-field w-36 text-sm" />
      <input type="date" name="targetDate" className="ac-field w-auto text-sm" />
      <button disabled={pending} className="ac-btn-ghost text-sm">
        {pending ? "添加中…" : "添加"}
      </button>
      {state?.error && <p className="basis-full text-right text-xs text-high">{state.error}</p>}
    </form>
  );
}
