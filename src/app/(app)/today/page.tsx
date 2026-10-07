import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadActionQueue, listMyOpenTasks } from "@/lib/shell";
import { listMyProjects } from "@/lib/project";
import { statusLabel } from "@/lib/task-status";
import { TodayActionRow } from "./today-action-row";
import { WorkspaceIcon } from "@/components/workspace-icon";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const [queue, openTasks, projects] = await Promise.all([
    loadActionQueue(session.user.id, { showAll }),
    listMyOpenTasks(session.user.id),
    listMyProjects(session.user.id),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <header className="ac-page-header">
        <p className="!mb-3 !mt-0 text-xs">你的工作，从这里接着做</p>
        <h1>今日</h1>
        <p>
          {queue.total
            ? "有 " +
              queue.total +
              " 件事需要你回应。先看清交接与成果，再决定下一步。"
            : projects.length
              ? "暂时没有待回应事项，可以继续推进手中的任务。"
              : "先找到一起做项目的团队，再开始第一轮协作。"}
        </p>
      </header>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-7">
          <section
            id="decisions"
            data-tour="today-queue"
            className="ac-focus-card scroll-mt-24"
          >
            <header className="flex items-center justify-between border-b border-stroke px-6 py-5">
              <h2 className="text-sm font-semibold text-ink">现在需要你处理</h2>
              <span className="rounded-md bg-signal-soft px-2 py-0.5 text-xs text-signal">
                {queue.total}
              </span>
            </header>
            {queue.items.length === 0 ? (
              <div className="px-6 py-12">
                <div className="flex items-start gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                    ✓
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-ink">
                      没有需要立即处理的事
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-ink-3">
                      {projects.length
                        ? "任务交接、成果验收和 AI 确认会在这里提醒你。"
                        : "加入团队后，分配给你的任务和邀请会出现在这里。"}
                    </p>
                    <Link
                      href={projects.length ? "/projects" : "/teams"}
                      className="mt-5 inline-flex text-xs font-semibold text-signal"
                    >
                      {projects.length ? "去项目继续推进" : "创建或加入团队"} →
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-stroke">
                {queue.items.map((a, i) => (
                  <li
                    key={
                      a.kind +
                      "-" +
                      (a.taskId ??
                        a.blockerId ??
                        a.decisionId ??
                        a.approvalId ??
                        i)
                    }
                  >
                    <TodayActionRow action={a} />
                  </li>
                ))}
              </ul>
            )}
            {queue.omitted > 0 && !showAll && (
              <Link
                href="/today?all=1"
                className="block border-t border-stroke px-6 py-4 text-xs text-signal"
              >
                还有 {queue.omitted} 项，展开查看 →
              </Link>
            )}
            {showAll && (
              <Link
                href="/today"
                className="block border-t border-stroke px-6 py-4 text-xs text-ink-3"
              >
                收起，只看高优先级
              </Link>
            )}
          </section>
          <section id="in-progress" className="scroll-mt-24">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">我在推进</h2>
              <span className="text-xs text-ink-3">{openTasks.length} 项</span>
            </div>
            {openTasks.length ? (
              <ul className="ac-focus-card divide-y divide-stroke">
                {openTasks.slice(0, 6).map((t) => (
                  <li key={t.taskId}>
                    <Link
                      href={
                        "/projects/" +
                        t.projectId +
                        "?space=work&task=" +
                        t.taskId
                      }
                      aria-label={
                        t.title +
                        "，状态：" +
                        statusLabel(t.status) +
                        "，项目：" +
                        t.projectName
                      }
                      className="flex items-start gap-4 p-5 hover:bg-sunken/50"
                    >
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">
                          {t.title}
                        </p>
                        <p className="mt-2 text-xs text-ink-3">
                          {t.projectName}
                        </p>
                      </div>
                      <span className="ac-badge shrink-0 bg-sunken text-ink-2">
                        {statusLabel(t.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-stroke px-5 py-7 text-sm text-ink-3">
                暂时没有在手任务。
                <Link href="/projects" className="ml-2 text-signal">
                  去项目看看 →
                </Link>
              </p>
            )}
          </section>
        </div>
        <aside className="space-y-8">
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">我的项目</h2>
              <Link
                href="/projects"
                className="text-xs text-ink-3 hover:text-signal"
              >
                全部 →
              </Link>
            </div>
            {projects.length ? (
              <ul className="space-y-3">
                {projects
                  .filter((p) => p.status !== "archived")
                  .slice(0, 3)
                  .map((p) => (
                    <li key={p.id}>
                      <Link
                        href={"/projects/" + p.id + "?space=work&panel=list"}
                        className="flex items-center gap-3 rounded-xl border border-stroke bg-panel p-4 hover:border-signal/30"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-sm text-ink-2">
                          {p.name.slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-ink">
                            {p.name}
                          </p>
                          <p className="mt-1 text-[11px] text-ink-3">
                            {p.taskTotal - p.doneCount} 项待推进
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm leading-7 text-ink-3">
                加入团队后，项目会出现在这里。
              </p>
            )}
          </section>
          <div className="rounded-xl bg-signal-soft/60 p-5">
            <WorkspaceIcon
              name="tutorials"
              className="mb-4 size-5 text-signal"
            />
            <h3 className="text-sm font-semibold text-ink">第一次使用？</h3>
            <p className="mt-2 text-xs leading-6 text-ink-2">
              跟着页面内的引导，亲手走一遍协作流程。
            </p>
            <Link
              href="/tutorials"
              className="mt-4 inline-block text-xs font-semibold text-signal"
            >
              开始互动教程 →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
