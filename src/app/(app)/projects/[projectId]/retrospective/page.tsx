import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { getProjectPerspective } from "@/lib/project-view";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { RetrospectiveReport } from "./report";

export default async function RetrospectivePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { role, viewUserId } = await getProjectPerspective(access.role, projectId, session.user.id, access.project.teamId);
  const personal = role === "student" || (role === "admin" && (await searchParams).scope === "mine");

  return (
    <div data-tour="retrospective">
      <RetrospectiveReport key={`${projectId}:${viewUserId}:${personal}`} projectId={projectId} personal={personal} showScopeSwitch={role === "admin"} />
    </div>
  );
}
