import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import type { TeamRole } from "@/db/schema";
import { listTeamMembers } from "@/lib/team";

export type ProjectViewMember = { id: string; name: string; role: TeamRole; kind: "human" | "agent" };

export function parseProjectView(value: string) {
  if (value === "admin") return { role: "admin" as const };
  const [role, memberId, extra] = value.split(":");
  if ((role !== "student" && role !== "teacher") || extra !== undefined || !z.uuid().safeParse(memberId).success) return null;
  return { role, memberId };
}

export function projectViewMembers(members: ProjectViewMember[]) {
  return members.filter(member => member.kind === "human" && (member.role === "student" || member.role === "teacher"))
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id));
}

/** Authentication remains the real user; a leader can operate for a current team member. */
export function resolveProjectPerspective(actual: TeamRole, actorId: string, members: ProjectViewMember[], requested?: string) {
  const fallback = { role: actual, viewUserId: actorId, viewUserName: null as string | null, preview: false, delegated: false, invalidSelection: false, selection: actual === "admin" ? "admin" : `${actual}:${actorId}` };
  if (actual !== "admin") return fallback;
  const choice = parseProjectView(requested ?? "admin");
  if (!choice) return { ...fallback, invalidSelection: true };
  if (choice.role === "admin") return fallback;
  const member = projectViewMembers(members).find(member => member.id === choice.memberId && member.role === choice.role);
  if (!member) return { ...fallback, invalidSelection: true };
  return { role: member.role, viewUserId: member.id, viewUserName: member.name, preview: false, delegated: true, invalidSelection: false, selection: `${member.role}:${member.id}` };
}

export const getProjectPerspective = cache(async (actual: TeamRole, projectId: string, actorId: string, teamId: string) => {
  // Callers have already checked project access. Revalidate roster membership on
  // every request so removed members or role changes invalidate saved previews.
  const members = actual === "admin" ? await listTeamMembers(teamId) : [];
  const requested = (await cookies()).get(`project-view-${projectId}`)?.value;
  return { ...resolveProjectPerspective(actual, actorId, members, requested), members: projectViewMembers(members) };
});

export async function getProjectView(actual: TeamRole, projectId: string, actorId: string, teamId: string) {
  return (await getProjectPerspective(actual, projectId, actorId, teamId)).role;
}
