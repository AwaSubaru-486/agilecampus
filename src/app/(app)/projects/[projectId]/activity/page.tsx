import Link from "next/link";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectActivity } from "@/lib/activity-feed";
import type { ActivityType } from "@/db/schema";

// 事件分类着色。与看板语义色同一套 token，靠色相区分性质而非严重程度。
const TYPE_TONE: Partial<Record<ActivityType, string>> = {
  task_created: "bg-primary",
  task_status_changed: "bg-doing",
  task_assigned: "bg-doing",
  task_updated: "bg-todo",
  task_labeled: "bg-todo",
  task_dependency_changed: "bg-todo",
  task_deleted: "bg-high",
  milestone_created: "bg-accent",
  project_created: "bg-done",
  project_updated: "bg-todo",
};

const TYPE_LABEL: Partial<Record<ActivityType, string>> = {
  task_created: "建任务",
  task_status_changed: "改状态",
  task_assigned: "改派",
  task_updated: "改任务",
  task_labeled: "贴标签",
  task_dependency_changed: "设依赖",
  task_deleted: "删任务",
  milestone_created: "建里程碑",
  project_created: "建项目",
  project_updated: "改项目",
};

// "M/D HH:mm"（本地时区）。活动流看的是「先后」，年月在同项目内多冗余，故略去年份。
function fmtTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const events = await listProjectActivity(session.user.id, projectId, { limit: 200 });

  return (
    <div className="mx-auto max-w-[82rem] space-y-5 py-1 sm:py-3">
      <header className="ac-card p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
          <Link href={`/projects/${projectId}`} className="text-ink-faint hover:text-primary">
            ← 返回工作台
          </Link>
          <span className="text-line-strong">/</span>
          <span className="text-primary">ACTIVITY</span>
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold text-ink">项目活动流</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
          {access.project.name} 的全部过程记录，按时间倒序。这些条目由系统在每次变更时自动登记，
          无需任何成员手动填写——项目结束后的贡献记录与复盘材料，也由此处算出。
        </p>
        <p className="mt-3 text-xs text-ink-faint">共 {events.length} 条记录</p>
      </header>

      {events.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          这里还没有活动记录。团队成员建任务、改状态、贴标签之后，过程会自动汇总到这里。
        </div>
      ) : (
        <div className="ac-card overflow-hidden">
          <ol className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${TYPE_TONE[e.type] ?? "bg-todo"}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 text-ink">
                    {/* actor 被删后 actorId 置 null，事件仍须可读 */}
                    <span className="font-medium">{e.actorName ?? "已注销成员"}</span>
                    <span className="text-ink-soft"> {e.summary ?? TYPE_LABEL[e.type] ?? e.type}</span>
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                    <span className="ac-badge bg-sunken text-ink-soft">
                      {TYPE_LABEL[e.type] ?? e.type}
                    </span>
                    <span className="tabular-nums">{fmtTime(e.createdAt)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
