type SummaryTask = {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  dueDate: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  planning: "规划中",
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
};

export function ProjectSummary({
  projectId,
  name,
  description,
  status,
  startDate,
  endDate,
  currentUserId,
  tasks,
}: {
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  currentUserId: string;
  tasks: SummaryTask[];
}) {
  const today = new Date().toLocaleDateString("sv-SE");
  const soonDate = new Date(`${today}T00:00:00`);
  soonDate.setDate(soonDate.getDate() + 7);
  const inSevenDays = soonDate.toLocaleDateString("sv-SE");
  const done = tasks.filter((task) => task.status === "done").length;
  const active = tasks.length - done;
  const mine = tasks.filter((task) => task.status !== "done" && task.assigneeId === currentUserId);
  const dueSoon = tasks.filter(
    (task) => task.status !== "done" && task.dueDate && task.dueDate >= today && task.dueDate <= inSevenDays,
  );
  const overdue = tasks.filter(
    (task) => task.status !== "done" && task.dueDate && task.dueDate < today,
  );
  const unassigned = tasks.filter((task) => task.status !== "done" && !task.assigneeId);
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <section id="overview" className="ac-card overflow-hidden scroll-mt-20">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="ac-badge bg-primary-soft text-primary">{STATUS_LABEL[status] ?? status}</span>
              <span className="text-xs text-ink-faint">{startDate ?? "待定"} — {endDate ?? "待定"}</span>
            </div>
            <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">{name}</h1>
            {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">{description}</p>}
          </div>
          <nav className="flex shrink-0 flex-wrap gap-2 text-sm" aria-label="项目工作台导航">
            <a href="#board" className="ac-btn-ghost">看板</a>
            <a href="#ai-collaboration" className="ac-btn-ghost">AI 协作</a>
            <a href={`/projects/${projectId}/timeline`} className="ac-btn-ghost">时间线</a>
          </nav>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" aria-label={`项目完成度 ${progress}%`}>
            <div className="h-full rounded-full bg-done transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-sm font-semibold tabular-nums text-ink">{progress}%</span>
          <span className="text-xs text-ink-faint">{done}/{tasks.length} 已完成</span>
        </div>
      </div>

      <div className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
        <FocusItem label="我负责" count={mine.length} hint={mine[0]?.title ?? "当前没有待办"} href={`?assignee=${currentUserId}#board`} />
        <FocusItem label="7 天内到期" count={dueSoon.length} hint={dueSoon[0]?.title ?? "近期节奏平稳"} href="#board" />
        <FocusItem label="已经逾期" count={overdue.length} hint={overdue[0]?.title ?? "没有逾期任务"} href="?overdue=1#board" alert={overdue.length > 0} />
        <FocusItem label="待认领" count={unassigned.length} hint={unassigned[0]?.title ?? `${active} 个进行中任务均已分配`} href="?assignee=none#board" />
      </div>
    </section>
  );
}

function FocusItem({
  label,
  count,
  hint,
  href,
  alert = false,
}: {
  label: string;
  count: number;
  hint: string;
  href: string;
  alert?: boolean;
}) {
  return (
    <a href={href} className="group border-b border-line px-4 py-3 transition hover:bg-sunken sm:border-r lg:border-b-0 last:border-r-0">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        <span className={`font-display text-xl font-semibold tabular-nums ${alert ? "text-high" : "text-ink"}`}>{count}</span>
      </span>
      <span className="mt-1 block truncate text-xs text-ink-faint group-hover:text-ink-soft">{hint}</span>
    </a>
  );
}
