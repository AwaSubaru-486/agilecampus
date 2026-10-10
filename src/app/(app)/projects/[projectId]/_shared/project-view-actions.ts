"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";

export async function setProjectView(projectId: string, view: string) {
  if (!z.uuid().safeParse(projectId).success || !["admin", "student", "teacher"].includes(view)) return { error: "视角不正确" };
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const access = await getProjectForUser(session.user.id, projectId);
  if (access?.role !== "admin") return { error: "只有组长可以切换预览视角" };
  (await cookies()).set(`project-view-${projectId}`, view, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: `/projects/${projectId}` });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { error: null };
}
