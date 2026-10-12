"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { parseProjectView, projectViewMembers } from "@/lib/project-view";

export async function setProjectView(projectId: string, view: string) {
  const choice = parseProjectView(view);
  if (!z.uuid().safeParse(projectId).success || !choice) return { error: "视角不正确" };
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const access = await getProjectForUser(session.user.id, projectId);
  if (access?.role !== "admin") return { error: "只有组长可以切换预览视角" };
  if (choice.role !== "admin") {
    const members = projectViewMembers(await listTeamMembers(access.project.teamId));
    if (!members.some(member => member.id === choice.memberId && member.role === choice.role)) return { error: "请选择当前小组的组员或老师" };
  }
  const origin = (await headers()).get("origin");
  (await cookies()).set(`project-view-${projectId}`, view, { httpOnly: true, sameSite: "lax", secure: origin?.startsWith("https://") ?? process.env.NODE_ENV === "production", path: `/projects/${projectId}` });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { error: null };
}
