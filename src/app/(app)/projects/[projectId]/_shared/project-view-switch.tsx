"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { TeamRole } from "@/db/schema";
import { NavigationProgress } from "@/components/navigation-progress";
import type { ProjectViewMember } from "@/lib/project-view";

export function ProjectViewSwitch({ projectId, view, selection, members, leaderName }: { projectId: string; view: TeamRole; selection: string; members: ProjectViewMember[]; leaderName: string }) {
  const [pending, setPending] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  return <form data-tour="project-view-switch" data-tour-member-view={view === "student" ? "true" : undefined} data-tour-teacher-view={view === "teacher" ? "true" : undefined} data-tour-leader-view={view === "admin" ? "true" : undefined} method="post" action={`/api/projects/${projectId}/view`} onSubmit={() => setPending(true)} className="flex flex-wrap items-center gap-3">
    <NavigationProgress active={pending} label="正在切换视角…" />
    <input type="hidden" name="returnTo" value={`${pathname}${search.size ? `?${search}` : ""}`} />
    <label className="flex items-center gap-2 text-xs text-ink-3">查看视角
      <select className="ac-field" name="view" aria-label="切换项目视角" defaultValue={selection} disabled={pending} onChange={event => { if (!pending) event.currentTarget.form?.requestSubmit(); }}>
        <option value="admin">{leaderName}（组长本人）</option>
        {members.some(member => member.role === "student") && <optgroup label="组员">{members.filter(member => member.role === "student").map(member => <option key={member.id} value={`student:${member.id}`}>{member.name}（组员）</option>)}</optgroup>}
        {members.some(member => member.role === "teacher") && <optgroup label="老师">{members.filter(member => member.role === "teacher").map(member => <option key={member.id} value={`teacher:${member.id}`}>{member.name}（老师）</option>)}</optgroup>}
      </select>
    </label>
    {pending && <span role="status" className="flex items-center gap-2 text-xs text-signal"><span className="ac-loading-dot" aria-hidden />正在切换视角…</span>}
  </form>;
}
