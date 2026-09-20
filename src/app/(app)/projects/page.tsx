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
    <main className="mx-auto max-w-6xl space-y-8 py-2 sm:py-4">
      <header className="flex flex-col justify-between gap-5 border-b border-stroke pb-7 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-signal">PROJECT SPACE</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">把想法推进到完成</h1>
          <p className="mt-2 text-sm text-ink-2">项目、任务和 AI 上下文都在同一个协作空间里。</p>
        </div>
        <div className="flex gap-6 sm:gap-8">
          <Metric value={activeProjects} label="进行中的项目" />
          <Metric value={`${overallProgress}%`} label="整体完成率" />
          <Metric value={totalTasks - completedTasks} label="剩余任务" />
        </div>
      </header>
      {projects.length === 0 ? (
        <div className="rounded-[var(--radius-panel)] border border-dashed border-stroke bg-panel p-14 text-center">
          <p className="font-medium text-ink">这里还没有项目</p>
          <p className="mt-1 text-sm text-ink-3">先进入团队空间，创建第一个协作项目。</p>
          <Link href="/teams" className="ac-btn mt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal">前往团队</Link>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p, index) => {
            const pct = p.taskTotal > 0 ? Math.round((p.doneCount / p.taskTotal) * 100) : 0;
            return (
              <li key={p.id} className="ac-card group relative overflow-hidden p-5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-signal/30 hover:shadow-pop">
                <div className="mb-7 flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-[0.13em] text-ink-3">AC / {String(index + 1).padStart(2, "0")}</span>
                  <span className={`size-2 rounded-full ${p.status === "archived" ? "bg-ink-3" : "bg-success shadow-[0_0_0_4px_rgba(22,138,99,0.12)]"}`} />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/projects/${p.id}`}
                    className="min-w-0 flex-1 font-display text-lg font-bold leading-snug text-ink group-hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal rounded-[var(--radius-control)]"
                  >
                    {p.name}
                  </Link>
                  <span className="text-lg text-ink-3 transition-transform group-hover:translate-x-1">→</span>
                </div>
                <p className="mt-1 text-xs text-ink-3">{p.teamName} · {p.status === "archived" ? "已归档" : "进行中"}</p>

                <div className="mt-7">
                  <div className="mb-1 flex items-center justify-between text-xs text-ink-2">
                    <span>{p.taskTotal - p.doneCount} 项待推进</span>
                    <span className="tabular-nums">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full bg-signal transition-[width] duration-200 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
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
