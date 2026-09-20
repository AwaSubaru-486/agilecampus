import Link from "next/link";
import { listProjectActivity } from "@/lib/activity-feed";
import { buildContributionReport } from "@/lib/contribution";
import { listProjectEntries } from "@/lib/entry";
import { listProjectTasks } from "@/lib/task";
import { ArchiveSection } from "../archive-section";

// 记录：形成了什么成果与证据。
//
// 这是项目的「身后事」——也是需求文档开篇那个痛点的正面回答：
// 「成果散落在不同工具中，难以形成完整的项目档案和可复用的过程资产」。
//
// 页面按 4.5 的次序排：成果与证据在前，过程记录在后。
// 复盘与活动流已有独立路由，此处给入口而不重复渲染——
// 活动流动辄几百条，塞进这一页会把它淹掉。

export async function RecordSpace({
  actorId,
  projectId,
  role,
  canWrite,
}: {
  actorId: string;
  projectId: string;
  role: "admin" | "teacher" | "student";
  canWrite: boolean;
}) {
  const [entries, projectTasks, contribution, activity] = await Promise.all([
    listProjectEntries(actorId, projectId, { limit: 60 }),
    listProjectTasks(actorId, projectId),
    buildContributionReport(actorId, projectId),
    listProjectActivity(actorId, projectId, { limit: 5 }),
  ]);

  const accepted = contribution.reviewStats.accepted;
  const deliverables = entries.filter((e) => e.type === "deliverable").length;
  const feedbacks = entries.filter((e) => e.type === "feedback").length;

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-panel)] border border-stroke bg-panel p-4 sm:p-5">
        <h2 className="font-display text-xl font-bold text-ink">这个项目留下了什么</h2>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
          <span>
            <span className="font-semibold tabular-nums text-ink">{accepted}</span> 项通过验收
          </span>
          <span>
            <span className="font-semibold tabular-nums text-human">{deliverables}</span> 项成果
          </span>
          <span>
            <span className="font-semibold tabular-nums text-ink">{feedbacks}</span> 条老师反馈
          </span>
          <span>
            <span className="font-semibold tabular-nums text-ink">{contribution.span.totalEvents}</span> 条过程记录
          </span>
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-3">
          上面的数字全部由系统在每次变更时自动登记，<span className="font-medium text-ink-2">没有任何一格需要成员手动填写</span>。
        </p>
      </section>

      <ArchiveSection
        projectId={projectId}
        entries={entries}
        tasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
        canWrite={canWrite}
        canGiveFeedback={role === "teacher" || role === "admin"}
      />

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke bg-ground/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">过程记录</h2>
          <Link
            href={`/projects/${projectId}/activity`}
            className="rounded-[var(--radius-control)] text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            看完整活动流 →
          </Link>
        </header>
        <ul className="divide-y divide-stroke">
          {activity.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-2 px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">{e.actorName ?? "已注销成员"}</span>
              {e.actorKind === "agent" && <span className="ac-agent-mark">协作者</span>}
              <span className="text-ink-2">{e.summary ?? e.type}</span>
            </li>
          ))}
          {activity.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-ink-2">还没有过程记录。</li>
          )}
        </ul>
        <div className="flex flex-wrap gap-3 border-t border-stroke bg-ground/30 px-4 py-2.5 text-xs">
          <Link
            href={`/projects/${projectId}/retrospective`}
            className="rounded-[var(--radius-control)] text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            项目复盘与贡献记录 →
          </Link>
        </div>
      </section>
    </div>
  );
}
