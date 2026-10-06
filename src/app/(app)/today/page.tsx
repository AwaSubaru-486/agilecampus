import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadActionQueue, listMyOpenTasks } from "@/lib/shell";
import { statusLabel } from "@/lib/task-status";
import { TodayActionRow } from "./today-action-row";

// 今日：跨项目的行动队列。登录后的默认落点，取代旧版的团队卡片页。
//
// 旧版问「有哪些项目」，这里问「现在该我做什么」。
// 队列的排序、去重全在 lib/action-queue.ts 的纯函数里，可单测；
// 徽章与这里同源，不会再出现「徽章说有 3 件、点进去只看到 2 件」。

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const showAll = sp.all === "1";

  const [queue, openTasks] = await Promise.all([
    loadActionQueue(session.user.id, { showAll }),
    listMyOpenTasks(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-[80rem] space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke pb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">今日</h1>
        <p className="text-sm font-medium text-ink-2">
          {queue.total === 0 ? "待处理 0" : `待处理 ${queue.total}`}
        </p>
      </header>

      {/* 需要你现在决定 */}
      <section id="decisions" data-tour="today-queue" className="scroll-mt-20 overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke bg-ground/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">待处理</h2>
            {queue.total > 0 && (
              <span className="rounded-full bg-signal-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-signal">
                {queue.total}
              </span>
            )}
          </div>
        </header>

        {queue.items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div
              aria-hidden
              className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-success-soft text-base font-bold text-success"
            >
              ✓
            </div>
            <p className="font-display text-base font-semibold text-ink">暂无待处理动作</p>
            <p className="mt-1 text-xs text-ink-3">待回应、待验收和待确认任务均为 0。</p>
            <Link
              href="/projects"
              className="mt-3 inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1"
            >
              查看项目 →
            </Link>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-stroke">
              {queue.items.map((a) => (
                <li key={`${a.kind}-${a.taskId ?? a.blockerId ?? a.decisionId ?? a.approvalId ?? a.title}`}>
                  <TodayActionRow action={a} />
                </li>
              ))}
            </ul>
            {queue.omitted > 0 && !showAll && (
              <div className="border-t border-stroke bg-ground/30 px-4 py-2 text-xs">
                <Link
                  href="/today?all=1"
                  className="rounded-[var(--radius-control)] text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  显示其余 {queue.omitted} 项 →
                </Link>
              </div>
            )}
            {showAll && (
              <div className="border-t border-stroke bg-ground/30 px-4 py-2 text-xs">
                <Link
                  href="/today"
                  className="rounded-[var(--radius-control)] text-ink-3 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  ← 仅显示高优先级
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      <div className="max-w-3xl">
        {/* 正在推进 */}
        <section id="in-progress" className="scroll-mt-20 overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">
          <header className="flex items-center justify-between border-b border-stroke bg-ground/50 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">我正在推进</h2>
            <span className="font-mono text-xs text-ink-3">{openTasks.length} 项在手</span>
          </header>
          {openTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-ink-3">
              暂无进行中任务。
              <Link
                href="/projects"
                className="ml-1 rounded-[var(--radius-control)] text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                查看项目任务 →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-stroke">
              {openTasks.slice(0, 6).map((t) => (
                <li key={t.taskId}>
                  <Link
                    href={`/projects/${t.projectId}?space=work&task=${t.taskId}`}
                    aria-label={`${t.title}，状态：${statusLabel(t.status)}，项目：${t.projectName}`}
                    className="flex flex-wrap items-baseline gap-2 px-4 py-2.5 transition-colors hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
                  >
                    <span className="text-sm font-medium text-ink">{t.title}</span>
                    <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink-3">{statusLabel(t.status)}</span>
                    <span className="ml-auto text-xs text-ink-3">{t.projectName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>
    </div>
  );
}
