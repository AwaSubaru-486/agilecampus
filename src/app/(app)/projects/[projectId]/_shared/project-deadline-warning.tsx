import Link from "@/components/feedback-link";
import { DUE_SOON_DAYS } from "@/lib/action-queue";
import { listProjectDeadlineWarnings } from "@/lib/project-deadlines";
import { statusLabel } from "@/lib/task-status";

type DeadlineTask = Awaited<ReturnType<typeof listProjectDeadlineWarnings>>[number];

export async function ProjectDeadlineWarning({ actorId, projectId, viewMemberId }: {
  actorId: string;
  projectId: string;
  viewMemberId: string;
}) {
  const warnings = await listProjectDeadlineWarnings(actorId, projectId, { viewMemberId });
  if (warnings.length === 0) return null;

  const overdue = warnings.filter(task => task.daysRemaining < 0).length;
  const dueSoon = warnings.length - overdue;
  const initial = warnings.slice(0, 3);
  const more = warnings.slice(initial.length);

  return (
    <section aria-labelledby="project-deadlines" className={`rounded-xl border px-4 py-3 sm:px-5 ${overdue ? "border-risk/30 bg-risk-soft/45" : "border-warn/30 bg-warn-soft/45"}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="project-deadlines" className="text-base font-semibold text-ink">任务逾期预警</h2>
        <p className="flex flex-wrap gap-x-4 text-sm font-medium">
          {overdue > 0 && <span className="text-risk">{overdue} 项已逾期</span>}
          {dueSoon > 0 && <span className="text-warn">{dueSoon} 项 {DUE_SOON_DAYS} 天内到期</span>}
        </p>
      </header>
      <DeadlineList projectId={projectId} tasks={initial} />
      {more.length > 0 && <details className="mt-2 border-t border-stroke pt-2">
        <summary className="cursor-pointer text-sm font-medium text-signal">查看其余 {more.length} 项</summary>
        <DeadlineList projectId={projectId} tasks={more} />
      </details>}
    </section>
  );
}

function DeadlineList({ projectId, tasks }: { projectId: string; tasks: DeadlineTask[] }) {
  return (
    <ul className="mt-2 divide-y divide-stroke">
      {tasks.map(task => {
        const late = task.daysRemaining < 0;
        const timing = late ? `已逾期 ${-task.daysRemaining} 天` : task.daysRemaining === 0 ? "今天截止" : `${task.daysRemaining} 天后截止`;
        return (
          <li key={task.id}>
            <Link href={`/projects/${projectId}?space=work&scope=mine&panel=list&task=${task.id}`} prefetch={false}
              className="group flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-1 py-2 focus-visible:outline-2 focus-visible:outline-signal sm:flex-nowrap">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-ink group-hover:underline group-hover:underline-offset-4">{task.title}</p>
                <p className="mt-0.5 text-xs text-ink-3"><time dateTime={task.dueDate}>{task.dueDate}</time> 截止 · {task.assigneeName ?? "待分配"} · {statusLabel(task.status)}</p>
              </div>
              <span className={`shrink-0 text-xs font-semibold ${late ? "text-risk" : "text-warn"}`}>{timing} <span aria-hidden>→</span></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
