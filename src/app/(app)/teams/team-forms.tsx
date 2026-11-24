"use client";

import { useActionState } from "react";
import { createTeamAction, joinTeamAction, type FormState } from "./actions";

export function TeamForms() {
  const [createState, createFormAction, creating] = useActionState<FormState, FormData>(
    createTeamAction,
    null,
  );
  const [joinState, joinFormAction, joining] = useActionState<FormState, FormData>(
    joinTeamAction,
    null,
  );

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <form data-tour="team-create" data-tour-complete={createState?.createdId ? "true" : "false"} action={createFormAction} className="ac-card space-y-2 p-4">
        <h2 className="font-medium text-ink">创建团队</h2>
        <input name="name" placeholder="团队名称" className="ac-field" />
        {createState?.createdId && <p role="status" className="text-xs text-success">团队已创建，可以继续认识成员分工。</p>}
        {createState?.error && <p className="text-sm text-high">{createState.error}</p>}
        <button disabled={creating} className="ac-btn">
          创建
        </button>
      </form>
      <form action={joinFormAction} className="ac-card space-y-2 p-4">
        <h2 className="font-medium text-ink">加入团队</h2>
        <input data-tour="team-invite" name="inviteCode" placeholder="邀请码" className="ac-field" />
        {joinState?.error && <p className="text-sm text-high">{joinState.error}</p>}
        <button disabled={joining} className="ac-btn">
          加入
        </button>
      </form>
    </div>
  );
}
