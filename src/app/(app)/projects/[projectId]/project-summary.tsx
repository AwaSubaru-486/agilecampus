import { isActive, isCompleted, isInFlight } from "@/lib/task-status";
import { today } from "@/lib/today";

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
  const day = today();
  const soonDate = new Date(`${day}T00:00:00`);
  soonDate.setDate(soonDate.getDate() + 7);
  const inSevenDays = soonDate.toLocaleDateString("sv-SE");
  // 进度分子只认已验收：待验收的活交出去了但没判过，算它完成会让进度虚高
  const done = tasks.filter((task) => isCompleted(task.status)).length;
  // 在办＝人还攥在手里的活，不含待验收（那已交到验收人手上）
  const active = tasks.filter((task) => isInFlight(task.status)).length;
  const mine = tasks.filter((task) => isInFlight(task.status) && task.assigneeId === currentUserId);
  const dueSoon = tasks.filter(
    (task) => isActive(task.status) && task.dueDate && task.dueDate >= day && task.dueDate <= inSevenDays,
  );
  const overdue = tasks.filter(
    (task) => isActive(task.status) && task.dueDate && task.dueDate < day,
  );
  const unassigned = tasks.filter((task) => isInFlight(task.status) && !task.assigneeId);
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <section id="overview" className="scroll-mt-20 space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="ac-card p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
            <span className="text-primary">PROJECT WORKSPACE</span>
            <span className="text-line-strong">/</span>
            <span className="text-ink-faint">{STATUS_LABEL[status] ?? status}</span>
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold text-ink sm:text-4xl">{name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">{description || "还没有项目说明。补充目标后，团队会更容易判断任务是否真正完成。"}</p>
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="项目工作台导航">
            <a href="#board" className="ac-btn">打开看板</a>
            <a href="#ai-collaboration" className="ac-btn-ghost">AI 协作</a>
            <a href={`/projects/${projectId}/timeline`} className="ac-btn-ghost">时间线</a>
            <a href={`/projects/${projectId}/activity`} className="ac-btn-ghost">活动流</a>
            <a href={`/projects/${projectId}/retrospective`} className="ac-btn-ghost">复盘</a>
          </nav>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-ink p-5 text-white shadow-card">
          <div className="absolute -right-10 -top-10 size-32 rounded-full border-[24px] border-white/[0.04]" />
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/45">PROGRESS</p>
          <p className="mt-5 font-display text-5xl font-bold tracking-[-0.06em]">{progress}<span className="ml-1 text-xl text-white/45">%</span></p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`项目完成度 ${progress}%`}>
            <div className="h-full rounded-full bg-[#7CF2C3] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-4 flex items-end justify-between">
            <p className="text-xs text-white/55">{done}/{tasks.length} 项已完成</p>
            <p className="text-right text-[10px] leading-4 text-white/35">{startDate ?? "待定"}<br />{endDate ?? "待定"}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
    <a href={href} className="ac-card group px-4 py-3.5 transition hover:border-primary/25 hover:shadow-pop">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-soft">{label}</span>
        <span className={`font-display text-xl font-semibold tabular-nums ${alert ? "text-high" : "text-ink"}`}>{count}</span>
      </span>
      <span className="mt-1 block truncate text-xs text-ink-faint group-hover:text-ink-soft">{hint}</span>
    </a>
  );
}
