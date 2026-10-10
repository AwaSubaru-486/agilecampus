import { cookies } from "next/headers";
import type { TeamRole } from "@/db/schema";

export function resolveProjectView(actual: TeamRole, requested?: string): TeamRole {
  return actual === "admin" && (requested === "student" || requested === "teacher") ? requested : actual;
}

export async function getProjectView(actual: TeamRole, projectId: string) {
  return resolveProjectView(actual, (await cookies()).get(`project-view-${projectId}`)?.value);
}
