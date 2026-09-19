import Link from "next/link";
import type { HealthIssue, HealthResult } from "@/lib/health";
import { HealthNarrator } from "./health-narrator";

const SIGNAL_LABEL: Record<HealthIssue["signal"], string> = {
  blocked: "有人卡住",
  overdue: "已逾期",
  review_latency: "验收积压",
  unassigned: "无人负责",
  stale: "长期未动",
  overload: "负荷过重",
};

// 项目健康度面板。
//
// 它不是仪表盘——没有分数、没有红黄绿灯。每条风险都得回答三件事：
// 为什么红、现在该做什么、谁来做。缺任何一件，这条风险就只是噪声。
export function HealthPanel({
  projectId,
  health,
}: {
  projectId: string;
  health: HealthResult;
}) {
  const { issues, healthy } = health;

  if (healthy) {
    return (
      <section id="health" className="scroll-mt-20">
        <div className="flex items-center gap-3 border-y border-done/30 bg-done/[0.04] px-0 py-3">
          <span aria-hidden className="size-2 rounded-full bg-done" />
          <p className="text-sm text-ink-soft">
            <span className="font-medium text-ink">当前没有待处理风险。</span>
            任务有人负责，求助和验收没有积压。
          </p>
        </div>
      </section>
    );
  }

  const high = issues.filter((i) => i.severity === "high").length;

  return (
    <section id="health" className="scroll-mt-20 border-y border-line">
      <div className="flex flex-wrap items-end justify-between gap-3 py-4">
        <div>
          <p className="text-[11px] font-medium tracking-[0.08em] text-ink-faint">风险 / 需要处理</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-ink">
            项目风险
            <span className="ml-2 align-middle text-sm font-normal text-ink-soft">
              {issues.length} 项待处理{high > 0 ? `，其中 ${high} 项要紧` : ""}
            </span>
          </h2>
          <p className="mt-1 text-xs text-ink-faint">每条风险都附带原因、动作和负责人。</p>
        </div>
        <Link href="/health" className="text-xs text-signal hover:underline">
          查看全部项目 →
        </Link>
      </div>

      <div className="border-t border-line">
        {issues.map((issue) => (
          <IssueCard key={issue.signal} projectId={projectId} issue={issue} />
        ))}
      </div>

      <HealthNarrator projectId={projectId} />
    </section>
  );
}

function IssueCard({ projectId, issue }: { projectId: string; issue: HealthIssue }) {
  const critical = issue.severity === "high";
  return (
    <article
      className={`grid gap-2 border-b border-line py-4 last:border-b-0 lg:grid-cols-[10rem_minmax(0,1fr)_12rem] lg:items-start lg:gap-5 ${critical ? "bg-high/[0.03]" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`ac-badge ${critical ? "bg-high-soft text-high" : "bg-medium-soft text-medium"}`}
        >
          {SIGNAL_LABEL[issue.signal]}
        </span>
        {critical && <span className="text-[11px] font-medium text-high">要紧</span>}
      </div>

      <p className="text-sm leading-6 text-ink">{issue.whyRed}</p>

      {/* 三问的后两问：该做什么、谁来做。两者都由代码渲染，AI 改不了 */}
      <div className="space-y-1 text-xs leading-5 text-ink-soft">
        <p><span className="text-ink-faint">建议动作 · </span>{issue.action}</p>
        <p><span className="text-ink-faint">负责人 · </span>{issue.ownerName ?? "需人来定"}</p>
      </div>

      <div className="space-y-1 text-[11px] leading-5 text-ink-faint">
        {issue.evidence.length > 0 && <p>{issue.evidence[0]}</p>}
        {issue.taskIds.length > 0 && (
          <Link href={`/projects/${projectId}#board`} className="text-signal hover:underline">
            查看关联任务 →
          </Link>
        )}
      </div>
    </article>
  );
}
