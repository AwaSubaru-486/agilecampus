import Link from "next/link";
import type { MilestoneProgress } from "@/lib/milestone";
import { HIGHLIGHT_LABEL } from "@/lib/milestone";
import type { RelayChain } from "@/lib/relay";
import { relayHeadline } from "@/lib/relay";
import { statusLabel } from "@/lib/task-status";
import type { LiveMember } from "@/lib/workspace";

// 工作现场。
//
// 与看板的分工：看板回答「每件事在哪个状态」，这里回答
// 「**现在这个团队在干什么**」——人和 AI 混在一起，一眼看全。
//
// 三段是有次序的：
//   正在发生 —— 此刻谁在动、谁卡住
//   接力     —— 一件事怎么在人和 AI 之间传下去
//   里程碑   —— 团队干成了什么（自动记录，不是人工填）

export function WorkspaceView({
  projectId,
  live,
  relays,
  milestones,
  milestoneForm,
}: {
  projectId: string;
  live: LiveMember[];
  relays: RelayChain[];
  milestones: MilestoneProgress[];
  /** 「新建里程碑」的表单，由页面注入——只有 admin 会拿到 */
  milestoneForm?: React.ReactNode;
}) {
  const agents = live.filter((m) => m.kind === "agent");
  const humans = live.filter((m) => m.kind === "human");
  const running = live.filter((m) => m.taskId && !m.stuck).length;
  const stuckCount = live.filter((m) => m.stuck).length;
  const firstStuck = live.find((m) => m.stuck) ?? null;
  const activePeople = live.filter((m) => m.taskId || m.awaitingCount > 0);

  return (
    <div className="space-y-5">
      <section id="workspace" className="ac-live-panel scroll-mt-20 overflow-hidden">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-stroke px-4 py-5 sm:px-6">
          <div>
            <p className="ac-eyebrow">现场 / 实时协作</p>
            <h2 className="mt-1.5 font-display text-[1.65rem] font-semibold tracking-[-0.03em] text-ink">现在发生什么</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">
              先看需要行动的事，再看已经交付的事。这里不展示静态资料，只展示团队此刻的工作状态。
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-stroke border border-stroke bg-ground/70">
            <Metric value={humans.length} label="成员" />
            <Metric value={agents.length} label="AI 协作者" tone="agent" />
            <Metric value={stuckCount} label="需搭手" tone={stuckCount > 0 ? "risk" : "quiet"} />
          </div>
        </header>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <div className="min-w-0 px-4 py-4 sm:px-6 sm:py-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="ac-section-title">工作中的人</p>
              <p className="text-xs text-ink-3">{running} 项推进中 · {activePeople.length} 项需要关注</p>
            </div>
            {live.length === 0 ? (
              <p className="border-t border-stroke py-8 text-center text-sm text-ink-2">目前没有正在推进的任务。</p>
            ) : (
              <ul className="divide-y divide-stroke border-y border-stroke">
                {live.map((m) => (
                  <LiveRow key={m.id} member={m} projectId={projectId} />
                ))}
              </ul>
            )}
          </div>

          <aside className="border-t border-stroke bg-ground/55 px-4 py-4 sm:px-6 sm:py-5 lg:border-l lg:border-t-0">
            <p className="ac-section-title">下一步</p>
            {firstStuck ? (
              <div className="mt-3">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-risk" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">有人在等搭手</p>
                    <p className="mt-1 text-sm leading-6 text-ink-2">
                      {firstStuck.name} 卡在「{firstStuck.taskTitle}」：{firstStuck.stuck}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/projects/${projectId}?task=${firstStuck.taskId}&space=work`}
                    className="ac-btn"
                  >
                    打开任务
                  </Link>
                  <Link
                    href={`/projects/${projectId}?space=studio`}
                    className="ac-btn-ghost"
                  >
                    查看 AI 工作现场
                  </Link>
                </div>
                <p className="mt-3 border-l-2 border-agent/50 pl-3 text-xs leading-5 text-ink-3">
                  接手后可以沿用原会话与上下文，不需要从头解释。
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-sm font-semibold text-ink">当前没有阻塞</p>
                <p className="mt-1 text-sm leading-6 text-ink-2">团队正在按计划推进，可以去任务流查看下一项交付。</p>
                <Link href={`/projects/${projectId}?space=work`} className="ac-btn-ghost mt-4">
                  查看任务流
                </Link>
              </div>
            )}
          </aside>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section id="relay" className="scroll-mt-20 rounded-[var(--radius-panel)] border border-stroke bg-panel p-4 sm:p-5">
          <header className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-ink-3">工作流 / 交接</p>
              <h2 className="mt-1 text-base font-semibold text-ink">接力链</h2>
            </div>
            <p className="text-xs text-ink-3">任务流转走向</p>
          </header>
          {relays.length === 0 ? (
            <p className="border-t border-stroke py-8 text-center text-sm text-ink-2">还没有流转中的工作。</p>
          ) : (
            <ul className="divide-y divide-stroke border-t border-stroke">
              {relays.map((c) => (
                <RelayRow key={c.taskId} chain={c} />
              ))}
            </ul>
          )}
        </section>

        <section id="milestones" className="scroll-mt-20 rounded-[var(--radius-panel)] border border-stroke bg-panel p-4 sm:p-5">
          <header className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-ink-3">交付 / 进度</p>
              <h2 className="mt-1 text-base font-semibold text-ink">下一里程碑</h2>
            </div>
            {milestoneForm && <div>{milestoneForm}</div>}
          </header>

          {milestones.length === 0 ? (
            <p className="border-t border-stroke py-8 text-center text-sm text-ink-2">还没有里程碑。</p>
          ) : (
            <ul className="divide-y divide-stroke border-t border-stroke">
              {milestones.map((m) => (
                <MilestoneRow key={m.id} m={m} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function LiveRow({ member, projectId }: { member: LiveMember; projectId: string }) {
  const isAgent = member.kind === "agent";
  const status = member.stuck
    ? { label: "卡住", cls: "text-risk", dot: "bg-risk" }
    : member.taskId
      ? { label: "在做", cls: "text-signal", dot: "bg-signal" }
      : member.awaitingCount > 0
        ? { label: "还没回话", cls: "text-warn", dot: "bg-warn" }
        : { label: "空闲", cls: "text-ink-3", dot: "bg-stroke-strong" };

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 py-3.5">
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${status.dot}`} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="font-semibold text-ink">{member.name}</span>
          {isAgent && <span className="ac-agent-mark">协作者</span>}
          <span className={`text-xs ${status.cls}`}>{status.label}</span>
        </p>
        {member.taskTitle ? (
          <Link
            href={`/projects/${projectId}?task=${member.taskId}&space=work`}
            className="mt-1 block truncate text-sm text-ink-2 underline decoration-stroke-strong underline-offset-4 transition-colors hover:text-signal hover:decoration-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {member.taskTitle}
          </Link>
        ) : member.awaitingCount > 0 ? (
          <p className="mt-1 text-xs text-ink-3">有 {member.awaitingCount} 件派下来的活还没有回应</p>
        ) : null}
        {member.stuck && <p className="mt-1 text-xs leading-5 text-risk">阻塞：{member.stuck}</p>}
      </div>
      {member.lastAt ? (
        <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-3">
          {agoLabel(member.lastAt)}
        </span>
      ) : (
        <span className="shrink-0 pt-0.5 text-[11px] text-ink-3">—</span>
      )}
    </li>
  );
}

function Metric({
  value,
  label,
  tone = "quiet",
}: {
  value: number;
  label: string;
  tone?: "quiet" | "agent" | "risk";
}) {
  const valueClass = tone === "risk" ? "text-risk" : tone === "agent" ? "text-agent" : "text-ink";
  return (
    <div className="min-w-[4.4rem] px-3 py-2.5 text-center sm:min-w-[5.25rem] sm:px-4">
      <p className={`font-display text-xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-3">{label}</p>
    </div>
  );
}

function RelayRow({ chain }: { chain: RelayChain }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{chain.taskTitle}</span>
        <span
          className={`text-[11px] ${
            chain.stuck ? "text-risk" : chain.status === "review" ? "text-agent" : "text-ink-3"
          }`}
        >
          {relayHeadline(chain)}
        </span>
      </div>

      {/* 链条本身。人和 AI 混在一条线上，只看名字后的 AI 标识区分 */}
      <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        {chain.steps.slice(-6).map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="px-1 text-stroke-strong">→</span>}
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-stroke bg-sunken/40 px-1.5 py-0.5">
              <span className="text-ink">{s.actorName ?? "谁"}</span>
              {s.actorKind === "agent" && (
                <span className="text-[9px] font-semibold text-agent">协作</span>
              )}
              <span className="text-ink-3">{s.action}</span>
            </span>
          </li>
        ))}
      </ol>

      {chain.stuck && <p className="mt-1.5 text-xs text-risk">卡在：{chain.stuck}</p>}
    </li>
  );
}

function MilestoneRow({ m }: { m: MilestoneProgress }) {
  const achieved = m.status === "done";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <span
            aria-hidden
            className={`grid size-4 place-items-center rounded-full text-[10px] ${
              achieved ? "bg-success text-white" : "border border-stroke-strong text-ink-3"
            }`}
          >
            {achieved ? "✓" : ""}
          </span>
          {m.title}
        </span>
        <span className="font-mono text-[11px] text-ink-3">
          {achieved
            ? `${m.achievedAt ? agoLabel(m.achievedAt) : ""}达成`
            : m.total > 0
              ? `${m.done}/${m.total} 项`
              : "尚无任务"}
        </span>
      </div>

      {/* 达成时自动冻结的实况——不是谁回来补写的 */}
      {m.autoSummary && (
        <p className="mt-1.5 border-l-2 border-success/40 bg-success-soft/30 px-2 py-1 text-xs leading-5 text-ink-2">
          {m.autoSummary}
        </p>
      )}

      {/* 高光是这块墙的重点：干成过什么难事，系统自己记的 */}
      {m.highlights.length > 0 && (
        <ul className="mt-2 space-y-1">
          {m.highlights.slice(0, 4).map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline gap-1.5 text-xs">
              <span className="ac-badge bg-warn-soft text-warn">{HIGHLIGHT_LABEL[h.kind]}</span>
              <span className="text-ink-2">{h.note}</span>
            </li>
          ))}
        </ul>
      )}

      {!achieved && m.remaining.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-ink-3">
          {m.remaining.slice(0, 3).map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-1.5">
              <span aria-hidden className="text-stroke-strong">·</span>
              <span className="text-ink-2">{r.title}</span>
              <span>{statusLabel(r.status)}</span>
              {r.assigneeName ? (
                <span className="flex items-center gap-1">
                  <span>{r.assigneeName}</span>
                  {r.assigneeKind === "agent" && (
                    <span className="text-[9px] font-semibold text-agent">协作</span>
                  )}
                </span>
              ) : (
                <span className="text-warn">没人接</span>
              )}
              {r.overdue && <span className="font-semibold text-risk">已逾期</span>}
            </li>
          ))}
          {m.remaining.length > 3 && <li>还有 {m.remaining.length - 3} 项</li>}
        </ul>
      )}
    </li>
  );
}

function agoLabel(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 2) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
