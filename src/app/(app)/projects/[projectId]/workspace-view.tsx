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

  return (
    <div className="space-y-6">
      <section id="workspace" className="scroll-mt-20 rounded-[var(--radius-panel)] border border-stroke bg-panel p-4 sm:p-5">
        <header className="flex flex-wrap items-end justify-between gap-3 pb-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.08em] text-ink-3">现场 / 当前状态</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-ink">现在发生什么</h2>
          </div>
          <p className="text-xs text-ink-3">
            {humans.length} 位成员 · {agents.length} 个协作者 · {running} 件在做
            {stuckCount > 0 && <span className="font-semibold text-risk"> · {stuckCount} 件卡住</span>}
          </p>
        </header>

        {live.length === 0 ? (
          <p className="border-t border-stroke py-8 text-center text-sm text-ink-2">目前没有正在推进的任务。</p>
        ) : (
          <ul className="divide-y divide-stroke border-t border-stroke">
            {live.map((m) => (
              <LiveRow key={m.id} member={m} projectId={projectId} />
            ))}
          </ul>
        )}
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
    <li className="flex items-start gap-3 py-3">
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${status.dot}`} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-1.5 text-sm">
          <span className="font-medium text-ink">{member.name}</span>
          {isAgent && <span className="ac-agent-mark">协作者</span>}
          <span className={`text-xs ${status.cls}`}>{status.label}</span>
          {member.taskTitle ? (
            <>
              <span className="text-ink-3">·</span>
              <Link
                href={`/projects/${projectId}?task=${member.taskId}&space=live`}
                className="min-w-0 truncate text-ink-2 hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal rounded-[var(--radius-control)]"
              >
                {member.taskTitle}
              </Link>
            </>
          ) : member.awaitingCount > 0 ? (
            <span className="text-xs text-ink-3">
              · 有 {member.awaitingCount} 件派给他但还没回话
            </span>
          ) : null}
        </p>
        {/* 卡住的 agent 不会自己喊——这一行是替它喊的 */}
        {member.stuck && <p className="mt-0.5 text-xs text-risk">阻塞：{member.stuck}</p>}
      </div>
      {member.lastAt && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
          {agoLabel(member.lastAt)}
        </span>
      )}
    </li>
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
