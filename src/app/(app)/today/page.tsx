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
    <div className="mx-auto max-w-[80rem] space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-bold text-ink">{name ? `${name}，今天` : "今天"}</h1>
        <p className="text-sm text-ink-2">
          {queue.total === 0 ? "眼下没有需要你动手的事。" : `${queue.total} 件事等你动手。`}
        </p>
      </header>

      {/* 需要你现在决定 */}
      <section className="overflow-hidden border-y border-stroke">
        <header className="flex flex-wrap items-baseline justify-between gap-2 py-3">
          <h2 className="text-sm font-semibold text-ink">需要你现在决定</h2>
          <p className="text-xs text-ink-3">按急迫程度排列，同一件事只出现一次</p>
        </header>

        {queue.items.length === 0 ? (
          <p className="border-t border-stroke py-10 text-center text-sm text-ink-2">
            没有待回应、也没有待验收的活。
            <Link href="/projects" className="ml-1 text-signal hover:underline">
              看看团队在做什么 →
            </Link>
          </p>
        ) : (
          <>
            <ul className="divide-y divide-stroke border-t border-stroke">
              {queue.items.map((a) => (
                <li key={`${a.kind}-${a.taskId ?? a.blockerId ?? a.title}`}>
                  <Link
                    href={
                      a.taskId
                        ? `/projects/${a.projectId}?space=live&task=${a.taskId}`
                        : `/projects/${a.projectId}?space=live`
                    }
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 transition-colors hover:bg-sunken"
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
            {queue.omitted > 0 && (
              <div className="border-t border-stroke py-2 text-xs">
                <Link href="/today?all=1" className="text-signal hover:underline">
                  另有 {queue.omitted} 件 →
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 正在推进 */}
        <section className="overflow-hidden border-y border-stroke">
          <header className="border-b border-stroke py-3">
            <h2 className="text-sm font-semibold text-ink">我正在推进</h2>
          </header>
          {openTasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-2">手上没有在办的活。</p>
          ) : (
            <ul className="divide-y divide-stroke">
              {openTasks.slice(0, 6).map((t) => (
                <li key={t.taskId}>
                  <Link
                    href={`/projects/${t.projectId}?space=live&task=${t.taskId}`}
                    className="flex flex-wrap items-baseline gap-2 py-2.5 transition-colors hover:bg-sunken"
                  >
                    <span className="text-sm text-ink">{t.title}</span>
                    <span className="text-xs text-ink-3">{statusLabel(t.status)}</span>
                    <span className="ml-auto text-xs text-ink-3">{t.projectName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 项目脉搏 */}
        <section className="overflow-hidden border-y border-stroke">
          <header className="border-b border-stroke py-3">
            <h2 className="text-sm font-semibold text-ink">项目脉搏</h2>
          </header>
          {projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-2">还没有项目。</p>
          ) : (
            <ul className="divide-y divide-stroke">
              {projects.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}?space=live`}
                    className="flex flex-wrap items-baseline gap-2 py-2.5 transition-colors hover:bg-sunken"
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
                  <li className="py-2">
                  <Link href="/projects" className="text-xs text-signal hover:underline">
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
