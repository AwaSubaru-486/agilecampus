"use client";

import { useActionState } from "react";
import { createProjectAction, type FormState } from "./actions";

export function ProjectForm({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createProjectAction,
    null,
  );

  return (
    <form data-tour="project-create" data-tour-complete={state?.createdId ? "true" : "false"} action={formAction} className="ac-card space-y-2 p-4">
      <h2 className="font-medium text-ink">创建项目</h2>
      <input type="hidden" name="teamId" value={teamId} />
      <input name="name" placeholder="项目名称" className="ac-field" />
      <textarea
        name="description"
        placeholder="项目描述（可选）"
        className="ac-field"
        rows={2}
      />
      <div className="flex gap-2">
        <label className="flex-1 text-sm text-ink-soft">
          开始日期
          <input type="date" name="startDate" className="ac-field" />
        </label>
        <label className="flex-1 text-sm text-ink-soft">
          结束日期
          <input type="date" name="endDate" className="ac-field" />
        </label>
      </div>
      {state?.createdId && <p role="status" className="text-xs text-success">项目已创建，可以继续规划第一轮。</p>}
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn">
        {pending ? "创建中…" : "创建"}
      </button>
    </form>
  );
}
