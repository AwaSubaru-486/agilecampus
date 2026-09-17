import Link from "next/link";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { buildContributionReport, NOT_MEASURABLE } from "@/lib/contribution";
import { BLOCKER_REASON_LABEL, type BlockerReason } from "@/lib/blocker-labels";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("sv-SE");
}

// 项目复盘。
//
// 这一页的每一个数字都是活动流自己长出来的，没有一格需要人填写。
// 也正因如此，它必须说清自己量不到什么——一份让人误以为全面的贡献表，
// 比一份明说局限的表有害得多。
export default async function RetrospectivePage({
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

  const report = await buildContributionReport(session.user.id, projectId);
  const { rows, blockerStats, reviewStats, span } = report;
  const hasData = span.totalEvents > 0;

  return (
    <div className="mx-auto max-w-[82rem] space-y-6 py-1 sm:py-3">
      <header className="ac-card p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
          <Link href={`/projects/${projectId}`} className="text-ink-faint hover:text-primary">
            ← 返回工作台
          </Link>
          <span className="text-line-strong">/</span>
          <span className="text-primary">RETROSPECTIVE</span>
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold text-ink">项目复盘</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
          {access.project.name} 的过程记录。全部数据由系统在每次变更时自动登记，
          <span className="font-medium text-ink">没有任何一格需要成员填写</span>。
        </p>
        {hasData && (
          <div className="mt-4 flex flex-wrap gap-5 text-xs text-ink-faint">
            <span>共 {span.totalEvents} 条过程记录</span>
            <span>
              跨度 {fmtDate(span.firstAt)} ~ {fmtDate(span.lastAt)}
            </span>
            <Link href={`/projects/${projectId}/activity`} className="text-primary hover:underline">
              看完整活动流 →
            </Link>
          </div>
        )}
      </header>

      {!hasData ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          还没有过程记录。团队成员建任务、认领、提交、验收之后，复盘材料会自动长出来。
        </div>
      ) : (
        <>
          <section className="ac-card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">各人做了什么</h2>
              <p className="mt-0.5 text-xs text-ink-faint">
                头条数字是「被验收通过的任务数」，不是「创建了多少」——后者可以灌水。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-medium text-ink-faint">
                    <th className="px-4 py-2">成员</th>
                    <th className="px-3 py-2 text-right">交付通过</th>
                    <th className="px-3 py-2 text-right">提交</th>
                    <th className="px-3 py-2 text-right">认领</th>
                    <th className="px-3 py-2 text-right">帮了别人</th>
                    <th className="px-3 py-2 text-right">参与验收</th>
                    <th className="px-3 py-2 text-right">被退回</th>
                    <th className="px-3 py-2 text-right">触及任务</th>
                    <th className="px-4 py-2 text-right">活跃天数</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{r.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                        {r.acceptedCount}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {r.submittedCount}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {r.claimedCount}
                        {r.estimatedHours > 0 && (
                          <span className="ml-1 text-[10px] text-ink-faint">
                            ({r.estimatedHours}h)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {r.helpedOthersCount}
                        {r.invitedCount > 0 && (
                          <span className="ml-1 text-[10px] text-ink-faint">
                            /受邀 {r.invitedCount}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {r.reviewedCount}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {r.rejectedCount}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {r.touchedTaskCount}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                        {r.activeDays}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-3 text-[11px] leading-5 text-ink-faint">
              「帮了别人」只认真的把他人求助标记为已解决的人；被推荐去帮忙不算。
              「被退回」受验收人严格程度影响，如实呈现，但不作为质量评价。
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="ac-card p-5">
              <h2 className="text-sm font-semibold text-ink">卡住过几次、卡在哪</h2>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft">
                <span>共 {blockerStats.total} 次求助</span>
                <span className="text-done">已解决 {blockerStats.resolved}</span>
                {blockerStats.open > 0 && (
                  <span className="text-accent">仍悬着 {blockerStats.open}</span>
                )}
                {blockerStats.avgResolveHours !== null && (
                  <span>平均 {blockerStats.avgResolveHours} 小时解决</span>
                )}
              </div>
              {blockerStats.byReason.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {blockerStats.byReason.map((b) => (
                    <li key={b.reason} className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-ink-soft">
                        {BLOCKER_REASON_LABEL[b.reason as BlockerReason] ?? b.reason}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${(b.count / blockerStats.total) * 100}%` }}
                        />
                      </span>
                      <span className="w-6 text-right tabular-nums text-ink-faint">{b.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[11px] leading-5 text-ink-faint">
                卡在哪一类环节最多，下次立项时就该在哪一类提前留出余量。
              </p>
            </section>

            <section className="ac-card p-5">
              <h2 className="text-sm font-semibold text-ink">交付与验收</h2>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft">
                <span className="text-done">验收通过 {reviewStats.accepted}</span>
                <span className={reviewStats.rejected > 0 ? "text-high" : ""}>
                  被退回 {reviewStats.rejected}
                </span>
                {reviewStats.rejectRate !== null && <span>退回率 {reviewStats.rejectRate}%</span>}
              </div>
              <p className="mt-4 text-[11px] leading-5 text-ink-faint">
                退回率不做横向比较：不同验收人的尺度不一样，同一个数在两个项目里含义不同。
                它只用来回答「我们这个阶段的交付标准，是不是一开始就没对齐」。
              </p>
            </section>
          </div>

          {/* 这一块是本页最重要的部分：说清自己量不到什么。
              一份让人误以为全面的贡献表，比一份明说局限的表有害得多。 */}
          <section className="ac-card border-medium/25 bg-medium-soft/20 p-5">
            <h2 className="text-sm font-semibold text-ink">这份记录量不到什么</h2>
            <p className="mt-1 text-xs leading-5 text-ink-soft">
              下列几点系统无从知晓，故
              <span className="font-medium text-ink">本项目刻意不产出任何「贡献总分」</span>
              ——把量不到的东西折算进一个数字，只会让那个数字失真。
            </p>
            <ul className="mt-3 space-y-1 text-xs leading-5 text-ink-soft">
              {NOT_MEASURABLE.map((t) => (
                <li key={t}>· {t}</li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-5 text-ink-faint">
              本页数据自动来自活动流与求助记录，无人工填写，亦不作为任何评价依据。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
