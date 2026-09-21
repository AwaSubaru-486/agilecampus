import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listProjectsHealth } from "@/lib/health";

// 跨项目健康度。面向组长与教师：一眼看清「哪个组现在需要我说话」。
//
// 与项目内的健康度面板是两件事：那个回答「这个项目怎么了」，
// 这个回答「我该先走进哪个项目」。故此处只给计数与头条，不铺明细。
export default async function HealthPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const rows = await listProjectsHealth(session.user.id);
  const totalHigh = rows.reduce((n, r) => n + r.highCount, 0);
  const needAttention = rows.filter((r) => r.issueCount > 0);
  const calm = rows.length - needAttention.length;

  return (
    <main className="mx-auto max-w-6xl space-y-8 py-2 sm:py-4">
      <header className="flex flex-col justify-between gap-5 border-b border-line pb-7 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-accent">PROJECT HEALTH</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
            哪个组需要你说话
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
            按风险排序，要紧的排前面。每一条都写明「为什么红、该做什么、谁来做」——
            看完可以直接去那个项目里处理，不必先自己判断哪儿出了问题。
          </p>
        </div>
        <div className="flex gap-6 sm:gap-8">
          <Metric value={needAttention.length} label="需要关注的项目" />
          <Metric value={totalHigh} label="要紧的风险" />
          <Metric value={calm} label="一切正常" />
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface p-14 text-center">
          <p className="font-medium text-ink">你还没有加入任何项目</p>
          <p className="mt-1 text-sm text-ink-faint">先进入团队空间，创建或加入一个协作项目。</p>
          <Link href="/teams" className="ac-btn mt-5">前往团队</Link>
        </div>
      ) : needAttention.length === 0 ? (
        <div className="ac-card flex items-center gap-3 border-done/25 bg-done/[0.04] px-5 py-4">
          <span aria-hidden className="size-2 rounded-full bg-done" />
          <p className="text-sm text-ink-soft">
            <span className="font-medium text-ink">你带的项目眼下都还稳。</span>
            没有逾期、没有人卡住、没有积压的验收。
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {needAttention.map((r) => (
            <li key={r.projectId} className="ac-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/projects/${r.projectId}?space=live`}
                    className="font-display text-lg font-bold text-ink hover:text-primary"
                  >
                    {r.projectName}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-faint">{r.teamName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.highCount > 0 && (
                    <span className="ac-badge bg-high-soft text-high">{r.highCount} 项要紧</span>
                  )}
                  <span className="ac-badge bg-sunken text-ink-soft">共 {r.issueCount} 项</span>
                </div>
              </div>

              {r.topIssue && (
                <p className="mt-3 border-l-2 border-accent/50 pl-3 text-sm leading-6 text-ink-soft">
                  {r.topIssue}
                </p>
              )}

              <Link
                href={`/projects/${r.projectId}?space=live#health`}
                className="mt-3 inline-block text-xs text-primary hover:underline"
              >
                看这个项目的健康度 →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {calm > 0 && needAttention.length > 0 && (
        <p className="text-xs text-ink-faint">另有 {calm} 个项目眼下没有需要干预的风险。</p>
      )}
    </main>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="font-display text-xl font-bold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 whitespace-nowrap text-[10px] text-ink-faint">{label}</p>
    </div>
  );
}
