import { z } from "zod";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getTeamMembership } from "@/lib/team";
import { listTeamAgents, sweepOfflineAgents, type AgentRow } from "@/lib/agent-member";
import type { AgentStatus } from "@/db/schema";
import { DeleteAgentButton, RegisterAgentForm, ReissueTokenButton } from "./agent-forms";

// agent 此刻状态的译法。措辞刻意贴近人话——
// 「它现在在干什么」比「status=working」有用得多。
const STATUS: Record<AgentStatus, { label: string; cls: string; hint: string }> = {
  idle: { label: "空闲", cls: "bg-done-soft text-done", hint: "在线，手上没活" },
  working: { label: "干活中", cls: "bg-primary-soft text-primary", hint: "正在处理任务" },
  blocked: { label: "卡住了", cls: "bg-high-soft text-high", hint: "已发出求助，等人搭手" },
  error: { label: "出错", cls: "bg-high-soft text-high", hint: "上一次执行失败了" },
  offline: { label: "离线", cls: "bg-sunken text-ink-soft", hint: "没有心跳，可能没开着" },
};

function agoLabel(d: Date | null): string {
  if (!d) return "从未报到";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "刚刚报到";
  if (mins < 60) return `${mins} 分钟前报到`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前报到`;
  return `${Math.floor(hours / 24)} 天前报到`;
}

export default async function AgentsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(teamId).success) notFound();

  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  // 读取前顺手把久未心跳的标为离线，免得显示一个昨天就跑掉的 agent 还在「在线」
  await sweepOfflineAgents(teamId);
  const agents = await listTeamAgents(session.user.id, teamId);
  const isAdmin = me.role === "admin";

  return (
    <main className="mx-auto max-w-3xl space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.14em] text-primary">AI TEAMMATES</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
            {team.name} · AI 成员
          </h1>
        </div>
        <a href={`/teams/${teamId}/members`} className="ac-btn-ghost">
          返回成员
        </a>
      </div>

      {isAdmin ? (
        <RegisterAgentForm teamId={teamId} />
      ) : (
        <p className="ac-card p-4 text-xs text-ink-soft">
          只有团队管理员可以注册或移除 AI 成员。
        </p>
      )}

      {agents.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          还没有 AI 成员。注册之后，它就能像人一样被指派任务——
          自己接活、汇报进展、卡住了会举手、做完交给你们验收。
        </div>
      ) : (
        <ul className="space-y-3">
          {agents.map((a) => (
            <AgentCard key={a.userId} agent={a} teamId={teamId} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
    </main>
  );
}

function AgentCard({
  agent,
  teamId,
  isAdmin,
}: {
  agent: AgentRow;
  teamId: string;
  isAdmin: boolean;
}) {
  const status = STATUS[agent.status];
  const full = agent.runningCount >= agent.maxConcurrent;

  return (
    <li className="ac-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{agent.name}</span>
            <span className={`ac-badge ${status.cls}`}>{status.label}</span>
            {full && <span className="ac-badge bg-medium-soft text-medium">已排满</span>}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            {agent.provider} · {status.hint} · {agoLabel(agent.lastSeenAt)}
          </p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-3">
            <ReissueTokenButton teamId={teamId} agentUserId={agent.userId} agentName={agent.name} />
            <DeleteAgentButton teamId={teamId} agentUserId={agent.userId} agentName={agent.name} />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
        <span>
          同时在办{" "}
          <span className="font-medium tabular-nums text-ink">
            {agent.runningCount}/{agent.maxConcurrent}
          </span>
        </span>
        {agent.ownerName && <span>由 {agent.ownerName} 注册</span>}
      </div>

      {agent.capabilities.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1">
          {agent.capabilities.map((c) => (
            <span key={c} className="ac-badge bg-sunken text-ink-soft">
              {c}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}
