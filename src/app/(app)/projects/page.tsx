import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";

export default async function AllProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const projects = await listMyProjects(session.user.id);
  const activeProjects = projects.filter((project) => project.status !== "archived").length;
  const totalTasks = projects.reduce((sum, project) => sum + project.taskTotal, 0);
  const completedTasks = projects.reduce((sum, project) => sum + project.doneCount, 0);
  const overallProgress = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <main data-tour="projects" className="mx-auto max-w-6xl space-y-6 py-2 sm:py-4">
      <header className="flex flex-col justify-between gap-5 border-b border-stroke pb-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">项目</h1>
        </div>
        <div className="flex gap-6 sm:gap-8">
          <Metric value={activeProjects} label="进行中的项目" />
          <Metric value={`${overallProgress}%`} label="整体完成率" />
          <Metric value={totalTasks - completedTasks} label="剩余任务" />
        </div>
      </header>
      {projects.length === 0 ? (
        <div className="rounded-[var(--radius-panel)] border border-stroke bg-panel p-14 text-center">
          <p className="font-medium text-ink">这里还没有项目</p>
          <p className="mt-1 text-sm text-ink-3">先进入团队空间，创建第一个协作项目。</p>
          <Link href="/teams" className="ac-btn mt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal">前往团队</Link>
        </div>
      ) : (
        <ul className="divide-y divide-stroke border-y border-stroke">
          {projects.map((p) => {
            const pct = p.taskTotal > 0 ? Math.round((p.doneCount / p.taskTotal) * 100) : 0;
            return (
              <li key={p.id} className="group">
                <Link
                  href={`/projects/${p.id}?space=work`}
                  className="grid gap-2 px-3 py-3.5 transition-colors hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal sm:grid-cols-[minmax(0,1.5fr)_11rem_minmax(10rem,0.75fr)_4rem_auto] sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="min-w-0 truncate font-medium text-ink group-hover:text-signal">{p.name}</span>
                  </div>
                  <div className="truncate text-xs text-ink-3">
                    <p className="truncate">{p.teamName}</p>
                    <p className="mt-0.5 text-[11px]">{p.status === "archived" ? "已归档" : "进行中"}</p>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-ink-3">
                      <span>{p.taskTotal - p.doneCount} 项待推进</span>
                      <span className="tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-1 overflow-hidden bg-sunken">
                      <div
                        className="h-full bg-signal transition-[width] duration-200 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className={`flex items-center gap-1.5 text-xs ${p.status === "archived" ? "text-ink-3" : "text-success"}`}>
                    <span className="size-1.5 rounded-full bg-current" />
                    {p.status === "archived" ? "归档" : "运行中"}
                  </span>
                  <span aria-hidden className="text-base text-ink-3 transition-transform group-hover:translate-x-0.5">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="font-display text-xl font-bold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 whitespace-nowrap text-[10px] text-ink-3">{label}</p>
    </div>
  );
}
