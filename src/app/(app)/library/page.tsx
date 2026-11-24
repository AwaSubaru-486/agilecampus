import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRetrospectiveProjects } from "@/lib/project-retrospective";

export const metadata = { title: "项目复盘 · AgileCampus" };

export default async function LibraryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const projects = await listRetrospectiveProjects(session.user.id);

  return (
    <div data-tour="library" className="mx-auto max-w-6xl">
      <header className="ac-page-header">
        <h1>项目复盘</h1>
        <p>选择一个项目，回看交付和验收意见，写下下一次要试的做法。</p>
      </header>
      {projects.length === 0 ? (
        <section className="ac-card px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-ink">暂无可复盘的项目</h2>
          <p className="mt-2 text-sm text-ink-3">加入项目后，可以从这里回看自己的交付。</p>
        </section>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="可查看复盘的项目">
          {projects.map(project => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}/retrospective`} prefetch={false} className="ac-project-card group h-full">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-ink-3">{project.teamName}{project.status === "archived" && " · 已归档"}</p>
                    <h2 className="ac-project-title mt-2 break-words text-lg font-semibold text-ink group-hover:text-signal">{project.name}</h2>
                  </div>
                  <span aria-hidden className="shrink-0 text-signal">↗</span>
                </div>
                <span className="mt-5 block text-sm font-medium text-signal">{project.role === "student" ? "回看我的任务" : "查看项目复盘"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
