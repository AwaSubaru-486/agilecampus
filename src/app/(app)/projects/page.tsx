import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { DeleteProjectButton } from "./[projectId]/_shared/delete-project-button";
import { WorkspaceIcon } from "@/components/workspace-icon";

export default async function AllProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [projects, memberships] = await Promise.all([
    listMyProjects(session.user.id),
    db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.userId, session.user.id)),
  ]);
  const active = projects.filter((p) => p.status !== "archived");
  const archived = projects.filter((p) => p.status === "archived");
  return (
    <div data-tour="projects" className="mx-auto max-w-6xl">
      <header className="ac-page-header flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1>我的项目</h1>
          <p>选一个项目，继续你和团队正在做的事。</p>
        </div>
        <Link href="/teams" className="ac-btn-ghost">
          创建或加入项目 <span aria-hidden>＋</span>
        </Link>
      </header>
      {projects.length === 0 ? (
        <section className="ac-focus-card px-6 py-16 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-signal-soft text-signal">
            <WorkspaceIcon name="projects" className="size-7" />
          </div>
          <h2 className="mt-6 text-xl font-semibold text-ink">
            从一个团队开始
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-ink-3">
            创建自己的团队，或使用同伴的邀请码加入。项目、分工和成果会在这里逐步展开。
          </p>
          <Link href="/teams" className="ac-btn mt-7">
            进入团队，开始协作 →
          </Link>
        </section>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between text-xs text-ink-3">
            <span>进行中，{active.length}</span>
            <span>进度以已验收任务为准</span>
          </div>
          <ul className="grid gap-5 xl:grid-cols-2">
            {active.map((p) => {
              const role = memberships.find((m) => m.teamId === p.teamId)?.role;
              const percent = p.taskTotal
                ? Math.round((p.doneCount / p.taskTotal) * 100)
                : 0;
              const href = "/projects/" + p.id;
              return (
                <li key={p.id} className="relative">
                  <Link href={href} className="ac-project-card group">
                    <div className="flex items-start gap-4">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-signal-soft text-base font-semibold text-signal">
                        {p.name.slice(0, 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-ink-3">
                          {p.teamName}，
                          {role === "admin"
                            ? "组长"
                            : role === "teacher"
                              ? "导师"
                              : "组员"}
                        </p>
                        <h2 className="mt-1.5 text-lg font-semibold leading-7 text-ink group-hover:text-signal">
                          {p.name}
                        </h2>
                      </div>
                      <WorkspaceIcon
                        name="arrow"
                        className="mt-3 size-4 text-ink-3"
                      />
                    </div>
                    <div className="mt-7 flex items-center justify-between text-xs text-ink-3">
                      <span>
                        {p.taskTotal
                          ? p.doneCount + " / " + p.taskTotal + " 项已验收"
                          : "还没有任务，从目标与分工开始"}
                      </span>
                      <span>{p.taskTotal ? percent + "%" : "等待规划"}</span>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken">
                      <div
                        className="h-full rounded-full bg-signal"
                        style={{ width: percent + "%" }}
                      />
                    </div>
                    <p className="mt-6 border-t border-stroke pt-4 pr-28 text-xs font-medium text-signal">
                      {p.taskTotal === 0
                        ? role === "admin"
                          ? "规划第一轮任务"
                          : "查看项目，等待分工"
                        : role === "teacher"
                          ? "查看交付与待审核任务"
                          : role === "admin"
                            ? "继续组织任务与交付"
                            : "查看我的任务"}{" "}
                      →
                    </p>
                  </Link>
                  {role === "admin" && <div className="absolute bottom-5 right-5"><DeleteProjectButton projectId={p.id} projectName={p.name} /></div>}
                </li>
              );
            })}
          </ul>
          {archived.length > 0 && (
            <details className="ac-disclosure mt-8">
              <summary>已归档项目，{archived.length}</summary>
              <ul className="divide-y divide-stroke">
                {archived.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 pr-5">
                    <Link
                      href={"/projects/" + p.id + "?space=record"}
                      className="flex flex-1 items-center justify-between gap-4 p-5 text-sm text-ink-2"
                    >
                      <span>{p.name}</span>
                      <span className="text-xs text-ink-3">查看成果 →</span>
                    </Link>
                    {memberships.find(m => m.teamId === p.teamId)?.role === "admin" && <DeleteProjectButton projectId={p.id} projectName={p.name} />}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
