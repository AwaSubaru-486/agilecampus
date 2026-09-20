import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadActionQueue, listMyOpenTasks } from "@/lib/shell";
import { KIND_ACTION, KIND_LABEL, type ActionKind } from "@/lib/action-queue";
import { statusLabel } from "@/lib/task-status";
import { listMyProjects } from "@/lib/project";

// 今日：跨项目的行动队列。登录后的默认落点，取代旧版的团队卡片页。
//
// 旧版问「有哪些项目」，这里问「现在该我做什么」。
// 队列的排序、去重全在 lib/action-queue.ts 的纯函数里，可单测；
// 徽章与这里同源，不会再出现「徽章说有 3 件、点进去只看到 2 件」。

const TONE: Record<ActionKind, string> = {
  assignment_response: "bg-warn-soft text-warn",
  decision_review: "bg-signal-soft text-signal",
  review: "bg-agent-soft text-agent",
  blocker_invite: "bg-risk-soft text-risk",
  rejected_work: "bg-risk-soft text-risk",
  overdue: "bg-risk-soft text-risk",
  due_soon: "bg-warn-soft text-warn",
};

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

  const name = session.user.name ?? "";

  return (
    <div className="mx-auto max-w-[80rem] space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke pb-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {name ? `${name}，今天` : "今天"}
          </h1>
          <p className="mt-0.5 text-xs text-ink-3">
            跨项目行动队列 · 按急迫度汇聚当下动作
          </p>
        </div>
        <p className="text-sm font-medium text-ink-2">
          {queue.total === 0 ? "眼下没有需要你动手的事。" : `${queue.total} 件事等你动手`}
        </p>
      </header>

      {/* 需要你现在决定 */}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke bg-ground/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">需要你现在决定</h2>
            {queue.total > 0 && (
              <span className="rounded-full bg-signal-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-signal">
                {queue.total}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-3">按急迫程度排列，同一件事只出现一次</p>
        </header>

        {queue.items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div
              aria-hidden
              className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-success-soft text-base font-bold text-success"
            >
              ✓
            </div>
            <p className="font-display text-base font-semibold text-ink">没有待回应、待验收或待确认的动作</p>
            <p className="mt-1 text-xs text-ink-3">你的待办队列很清爽，各项进度都在正常流转。</p>
            <Link
              href="/projects"
              className="mt-3 inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1"
            >
              看看各项目的现场 →
            </Link>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-stroke">
              {queue.items.map((a) => (
                <li key={`${a.kind}-${a.taskId ?? a.blockerId ?? a.title}`}>
                  <Link
                    href={
                      a.decisionId
                        ? `/projects/${a.projectId}?space=record#decisions`
                        : a.taskId
                        ? `/projects/${a.projectId}?space=live&task=${a.taskId}`
                        : `/projects/${a.projectId}?space=live`
                    }
                    aria-label={`${KIND_LABEL[a.kind]}：${a.title}，项目：${a.projectName}，操作：${KIND_ACTION[a.kind]}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
                  >
                    <span className={`ac-badge ${TONE[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                    <span className="text-sm font-medium text-ink">{a.title}</span>
                    <span className="text-xs text-ink-3">{a.projectName}</span>
                    {a.context && (
                      <span className="w-full text-xs text-ink-3 sm:w-auto">{a.context}</span>
                    )}
                    <span className="ml-auto shrink-0 text-xs font-medium text-signal">
                      {KIND_ACTION[a.kind]} →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {queue.omitted > 0 && !showAll && (
              <div className="border-t border-stroke bg-ground/30 px-4 py-2 text-xs">
                <Link
                  href="/today?all=1"
                  className="rounded-[var(--radius-control)] text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  另有 {queue.omitted} 件紧要度较低的待办 →
                </Link>
              </div>
            )}
            {showAll && (
              <div className="border-t border-stroke bg-ground/30 px-4 py-2 text-xs">
                <Link
                  href="/today"
                  className="rounded-[var(--radius-control)] text-ink-3 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  ← 收起只看最紧要待办
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 正在推进 */}
        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">
          <header className="flex items-center justify-between border-b border-stroke bg-ground/50 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">我正在推进</h2>
            <span className="font-mono text-xs text-ink-3">{openTasks.length} 项在手</span>
          </header>
          {openTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-ink-3">
              手上没有在办的活。
              <Link
                href="/projects"
                className="ml-1 rounded-[var(--radius-control)] text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                去项目认领任务 →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-stroke">
              {openTasks.slice(0, 6).map((t) => (
                <li key={t.taskId}>
                  <Link
                    href={`/projects/${t.projectId}?space=live&task=${t.taskId}`}
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

        {/* 项目脉搏 */}
        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">
          <header className="flex items-center justify-between border-b border-stroke bg-ground/50 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">项目脉搏</h2>
            <span className="font-mono text-xs text-ink-3">{projects.length} 个项目</span>
          </header>
          {projects.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-ink-3">
              还没有加入任何项目。
            </div>
          ) : (
            <ul className="divide-y divide-stroke">
              {projects.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}?space=live`}
                    aria-label={`${p.name}，团队：${p.teamName}，${p.taskTotal - p.doneCount} 项待推进`}
                    className="flex flex-wrap items-baseline gap-2 px-4 py-2.5 transition-colors hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
                  >
                    <span className="text-sm font-medium text-ink">{p.name}</span>
                    <span className="text-xs text-ink-3">{p.teamName}</span>
                    <span className="ml-auto text-xs tabular-nums text-ink-3">
                      {p.taskTotal - p.doneCount} 项待推进
                    </span>
                  </Link>
                </li>
              ))}
              {projects.length > 4 && (
                <li className="bg-ground/30 px-4 py-2">
                  <Link
                    href="/projects"
                    className="rounded-[var(--radius-control)] text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                  >
                    全部 {projects.length} 个项目 →
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
