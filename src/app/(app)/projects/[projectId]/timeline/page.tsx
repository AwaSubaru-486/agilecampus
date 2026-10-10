import Link from "next/link";
import { db } from "@/db";
import { taskTreeDrafts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTaskTree, taskTreePayloadSchema, type TaskTreePayload } from "@/lib/task-tree";
import { listTeamMembers } from "@/lib/team";
import { getProjectView } from "@/lib/project-view";
import { emptyDraftPlan } from "@/lib/draft-planning";
import { TimelineTaskTrees, type TimelineTreeGroup } from "./timeline-task-trees";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { isActive, statusLabel } from "@/lib/task-status";

const DAY = 86_400_000;

// "YYYY-MM-DD" → 本地零点毫秒；无值返回 null
function parseDay(s: string | null): number | null {
  if (!s) return null;
  const t = new Date(`${s}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

function fmtMD(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}

type TaskRow = Awaited<ReturnType<typeof listProjectTasks>>[number];

interface Bar {
  id: string;
  title: string;
  status: string;
  leftPct: number;
  widthPct: number;
  overdue: boolean;
  rangeLabel: string;
}

export default async function TimelinePage({
  params, searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const role = await getProjectView(access.role, projectId);
  const query = await searchParams;
  const showDates = query.diagram === "schedule";
  const [tasks, milestones, tree, dependencies, published, members] = await Promise.all([
    showDates ? listProjectTasks(session.user.id, projectId) : Promise.resolve([]),
    showDates ? listProjectMilestones(session.user.id, projectId) : Promise.resolve([]),
    showDates ? Promise.resolve({ stages: [], tasks: [], drafts: [] }) : getTaskTree(session.user.id, projectId),
    showDates ? Promise.resolve([]) : listProjectDependencies(session.user.id, projectId),
    showDates ? Promise.resolve([]) : db.select({ id: taskTreeDrafts.id, briefId: taskTreeDrafts.briefId, payload: taskTreeDrafts.payload }).from(taskTreeDrafts).where(and(eq(taskTreeDrafts.projectId, projectId), eq(taskTreeDrafts.status, "published"))),
    showDates ? Promise.resolve([]) : listTeamMembers(access.project.teamId),
  ]);
  const publishedDrafts = published.map(draft => ({ ...draft, payload: taskTreePayloadSchema.parse(draft.payload) }));
  const groups: TimelineTreeGroup[] = [];
  const stageGroups = [...tree.stages, ...(tree.tasks.some(task => !task.stageId) ? [{ id: "unassigned-stage", title: "未归入阶段的任务", sourceBriefId: null }] : [])];
  for (const stage of stageGroups) {
    const rows = tree.tasks.filter(task => stage.id === "unassigned-stage" ? !task.stageId : task.stageId === stage.id);
    if (!rows.length) continue;
    const keys = new Set(rows.map(task => task.id));
    const payload: TaskTreePayload = { summary: stage.title, stages: [{ title: stage.title, tasks: rows.map(task => ({ key: task.id, parentKey: task.parentTaskId && keys.has(task.parentTaskId) ? task.parentTaskId : null, title: task.title, description: task.description ?? "", assigneeId: task.id, priority: task.priority, doneCriteria: Array.isArray(task.doneCriteria) ? task.doneCriteria.filter((value): value is string => typeof value === "string") : [] })) }] };
    const links = emptyDraftPlan(payload).stages[0].links.map(link => ({ ...link, afterKeys: dependencies.filter(edge => edge.successorId === link.key && keys.has(edge.predecessorId)).map(edge => edge.predecessorId), reason: "项目中设置的任务后续关系" }));
    const draft = publishedDrafts.find(item => item.briefId === stage.sourceBriefId);
    const draftStageIndex = tree.stages.filter(item => item.sourceBriefId === stage.sourceBriefId).findIndex(item => item.id === stage.id);
    groups.push({ id: stage.id, title: stage.title, payload, pending: false, links, draftId: draft?.id, draftStageIndex, details: rows.map(task => ({ key: task.id, taskId: task.id, status: statusLabel(task.status), owner: task.assigneeName ?? "待分配" })) });
  }
  const pendingDrafts = role === "admin" ? tree.drafts : [];
  for (const draft of pendingDrafts) draft.payload.stages.forEach((stage, index) => {
    const payload = { summary: draft.payload.summary, stages: [{ ...stage, tasks: stage.tasks.map(task => ({ ...task, assigneeId: task.key })) }] };
    groups.push({ id: `${draft.id}-${index}`, title: stage.title, payload, pending: true, draftId: draft.id, draftStageIndex: index, links: emptyDraftPlan(payload).stages[0].links, details: stage.tasks.map(task => ({ key: task.key, taskId: null, status: "待确认", owner: members.find(member => member.id === task.assigneeId)?.name ?? "待分配" })) });
  });

  // 拆出「已排期」（至少有起始或截止日）与「未排期」
  const scheduled: { task: TaskRow; start: number; end: number }[] = [];
  const unscheduled: TaskRow[] = [];
  for (const t of tasks) {
    const s0 = parseDay(t.startDate);
    const d0 = parseDay(t.dueDate);
    if (s0 === null && d0 === null) {
      unscheduled.push(t);
      continue;
    }
    const start = s0 ?? d0!;
    let end = (d0 ?? s0!) + DAY; // 截止日含当日 → +1 天，保证有宽度
    if (end <= start) end = start + DAY;
    scheduled.push({ task: t, start, end });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  return (
    <main data-tour="timeline" className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-ink">时间线</h2>
        <p className="text-sm text-ink-soft">
          查看任务先后与并行分支，也可以切换到日期排期。
        </p>
      </header>

      <nav aria-label="时间线显示方式" className="ac-view-switch"><Link href={`/projects/${projectId}/timeline`} aria-current={!showDates ? "page" : undefined}>任务树</Link><Link href={`/projects/${projectId}/timeline?diagram=schedule`} aria-current={showDates ? "page" : undefined}>日期排期</Link></nav>
      {!showDates ? <TimelineTaskTrees projectId={projectId} groups={groups} drafts={[...publishedDrafts, ...pendingDrafts].map(draft => ({ id: draft.id, payload: draft.payload }))} /> : <>
      {scheduled.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          暂无已排期任务。为任务填写起始日或截止日。
        </div>
      ) : (
        <Gantt scheduled={scheduled} milestones={milestones} todayMs={todayMs} />
      )}

      {unscheduled.length > 0 && (
        <section className="ac-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            未排期（{unscheduled.length}）
          </h2>
          <ul className="flex flex-wrap gap-2">
            {unscheduled.map((t) => (
              <li key={t.id} className="ac-badge bg-sunken text-ink-soft">
                {t.title}
              </li>
            ))}
          </ul>
        </section>
      )}
      </>}
    </main>
  );
}

function Gantt({
  scheduled,
  milestones,
  todayMs,
}: {
  scheduled: { task: TaskRow; start: number; end: number }[];
  milestones: { id: string; title: string }[];
  todayMs: number;
}) {
  // 时间范围：涵盖全部横条 + 今日，两端各留 4% 余白
  let min = Math.min(...scheduled.map((s) => s.start), todayMs);
  let max = Math.max(...scheduled.map((s) => s.end), todayMs + DAY);
  const rawSpan = Math.max(max - min, DAY);
  const pad = rawSpan * 0.04;
  min -= pad;
  max += pad;
  const span = max - min;

  const pct = (ms: number) => ((ms - min) / span) * 100;

  // 5 个均匀刻度
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
  const todayPct = pct(todayMs);

  // 按里程碑分组（保持里程碑顺序，末尾附「无里程碑」）
  const groups: { key: string; title: string; bars: Bar[] }[] = [];
  const ensure = (key: string, title: string) => {
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, title, bars: [] };
      groups.push(g);
    }
    return g;
  };
  for (const m of milestones) ensure(m.id, m.title);

  // 补 review 一色。兜底仍在（见下方 ?? "bg-todo"），但那是给未知状态用的，
  // 加档时若忘了往这里补，后果是静默错色而非报错——故改档位时务必回来核一眼。
  const STATUS_BAR: Record<string, string> = {
    todo: "bg-todo",
    doing: "bg-doing",
    review: "bg-review",
    done: "bg-done",
  };

  for (const { task, start, end } of scheduled) {
    // 待验收仍算逾期：活没过验收就没交付完
    const overdue =
      isActive(task.status) && task.dueDate !== null && (parseDay(task.dueDate) ?? 0) < todayMs;
    const bar: Bar = {
      id: task.id,
      title: task.title,
      status: task.status,
      leftPct: pct(start),
      widthPct: Math.max(pct(end) - pct(start), 1.5),
      overdue,
      rangeLabel: `${task.startDate ?? "…"}→${task.dueDate ?? "…"}`,
    };
    ensure(task.milestoneId ?? "__none__", "无里程碑").bars.push(bar);
  }

  const nonEmpty = groups.filter((g) => g.bars.length > 0);

  return (
    <div className="ac-card overflow-hidden">
      {/* 时间刻度头 */}
      <div className="relative border-b border-line bg-sunken/60 px-4 py-2">
        <div className="relative ml-40 h-4">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute -translate-x-1/2 text-[11px] tabular-nums text-ink-faint"
              style={{ left: `${pct(t)}%` }}
            >
              {fmtMD(t)}
            </span>
          ))}
        </div>
      </div>

      <div>
        {nonEmpty.map((g) => (
          <div key={g.key} className="border-b border-line last:border-b-0">
            <div className="bg-sunken/40 px-4 py-1.5 text-xs font-semibold text-ink-soft">
              {g.title}
            </div>
            <ul>
              {g.bars.map((b) => (
                <li key={b.id} className="flex items-center px-4 py-1.5">
                  <span className="w-40 shrink-0 truncate pr-2 text-xs text-ink" title={b.title}>
                    {b.title}
                  </span>
                  <span className="relative h-5 flex-1">
                    {todayPct >= 0 && todayPct <= 100 && (
                      <span
                        className="pointer-events-none absolute inset-y-0 w-px bg-accent/70"
                        style={{ left: `${todayPct}%` }}
                        aria-hidden
                      />
                    )}
                    <span
                      className={`absolute top-0 flex h-5 items-center overflow-hidden rounded px-1.5 text-[10px] text-white ${
                        b.overdue ? "bg-high" : STATUS_BAR[b.status] ?? "bg-todo"
                      }`}
                      style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%`, minWidth: "2rem" }}
                      title={b.rangeLabel}
                    >
                      <span className="truncate">{b.rangeLabel}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-ink-soft">
        <Legend cls="bg-todo" label="待办" />
        <Legend cls="bg-doing" label="进行中" />
        <Legend cls="bg-review" label="待验收" />
        <Legend cls="bg-done" label="已完成" />
        <Legend cls="bg-high" label="逾期" />
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-px bg-accent/70" /> 今日
        </span>
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}
