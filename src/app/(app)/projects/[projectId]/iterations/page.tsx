import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { getProjectPerspective } from "@/lib/project-view";
import { getProjectIterationWorkspace } from "@/lib/project-iterations";
import { IterationsWorkspace } from "./iterations-workspace";

export default async function IterationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const [perspective, workspace] = await Promise.all([
    getProjectPerspective(access.role, projectId, session.user.id, access.project.teamId),
    getProjectIterationWorkspace(session.user.id, projectId),
  ]);
  return <IterationsWorkspace projectId={projectId} {...workspace} canManage={perspective.role === "admin" && !perspective.invalidSelection} />;
}
