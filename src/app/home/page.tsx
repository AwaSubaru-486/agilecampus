import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { homeProfiles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";

export const metadata = { title: "家园 · AgileCampus" };

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login?returnTo=home");

  const [projects, [home]] = await Promise.all([
    listMyProjects(session.user.id),
    db.select({ projectId: homeProfiles.workingProjectId }).from(homeProfiles).where(eq(homeProfiles.ownerId, session.user.id)),
  ]);
  const project = projects.find(item => item.id === home?.projectId)
    ?? projects.find(item => item.status === "active")
    ?? projects.find(item => item.status !== "archived");
  redirect(project ? `/projects/${project.id}` : "/projects");
}
