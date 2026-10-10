"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { TeamRole } from "@/db/schema";

export function ProjectViewSwitch({ projectId, view }: { projectId: string; view: TeamRole }) {
  const [pending, setPending] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  return <form data-tour="project-view-switch" data-tour-member-view={view === "student" ? "true" : undefined} data-tour-teacher-view={view === "teacher" ? "true" : undefined} data-tour-leader-view={view === "admin" ? "true" : undefined} method="post" action={`/api/projects/${projectId}/view`} onSubmit={() => setPending(true)} className="flex flex-wrap items-center gap-3">
    <input type="hidden" name="returnTo" value={`${pathname}${search.size ? `?${search}` : ""}`} />
    <label className="flex items-center gap-2 text-xs text-ink-3">查看视角
      <select className="ac-field" name="view" aria-label="切换项目视角" defaultValue={view} onChange={event => { if (!pending) event.currentTarget.form?.requestSubmit(); }}>
        <option value="admin">组长</option><option value="student">组员（预览）</option><option value="teacher">老师（预览）</option>
      </select>
    </label>
    {pending && <span role="status" className="text-xs text-signal">正在切换视角…</span>}
  </form>;
}
