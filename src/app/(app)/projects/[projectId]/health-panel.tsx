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
        <div className="ac-card flex items-center gap-3 border-done/25 bg-done/[0.04] px-4 py-3">
          <span aria-hidden className="size-2 rounded-full bg-done" />
          <p className="text-sm text-ink-soft">
            <span className="font-medium text-ink">眼下没有需要干预的风险。</span>
            任务在动、有人负责、没有积压的求助与验收。
          </p>
        </div>
      </section>
    );
  }

  const high = issues.filter((i) => i.severity === "high").length;

  return (
    <section id="health" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.14em] text-accent">HEALTH</p>
          <h2 className="mt-1 font-display text-2xl font-bold text-ink">
            项目健康度
            <span className="ml-2 align-middle text-sm font-normal text-ink-soft">
              {issues.length} 项待处理{high > 0 ? `，其中 ${high} 项要紧` : ""}
            </span>
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            每条都写明了「为什么红、该做什么、谁来做」——不是给你看的分数，是给你做的事。
          </p>
        </div>
        <Link href="/health" className="ac-btn-ghost">
          看全部项目
        </Link>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
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
      className={`ac-card space-y-2 p-4 ${critical ? "border-high/30 bg-high/[0.03]" : ""}`}
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
      <p className="text-xs leading-5 text-ink-soft">
        <span className="text-ink-faint">该做什么 · </span>
        {issue.action}
      </p>
      <p className="text-xs text-ink-faint">
        谁来做 ·{" "}
        {issue.ownerName ? (
          <span className="font-medium text-ink-soft">{issue.ownerName}</span>
        ) : (
          "需人来定"
        )}
      </p>

      {issue.evidence.length > 0 && (
        <ul className="space-y-0.5 border-t border-line pt-2 text-[11px] leading-5 text-ink-faint">
          {issue.evidence.map((e, i) => (
            <li key={i}>· {e}</li>
          ))}
        </ul>
      )}

      {issue.taskIds.length > 0 && (
        <Link
          href={`/projects/${projectId}#board`}
          className="inline-block text-[11px] text-primary hover:underline"
        >
          去看这些任务 →
        </Link>
      )}
    </article>
  );
}
