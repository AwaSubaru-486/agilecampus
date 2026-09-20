import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { agents, blockers, projects, teamMembers, users } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

// 协作：求助邀请与 AI 成员状态。
//
// 旧版没有这一页——求助散在各个项目里，AI 状态藏在项目页中部。
// 这里把它们提到一级导航，因为「谁在等搭手」「AI 在干什么」
// 是每天都要看一眼的事，不该埋进某个项目里找。
//
// Commit 2 先落求助与 AI 状态两块；Commit 10 会补上待确认的 AI 动作池。
export default async function CollaborationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, session.user.id));
  const teamIds = memberships.map((m) => m.teamId);

  if (teamIds.length === 0) {
    return (
      <div className="mx-auto max-w-[80rem]">
        <h1 className="font-display text-2xl font-bold text-ink">协作</h1>
        <p className="ac-card mt-4 p-8 text-center text-sm text-ink-2">
          你还没有加入任何团队。
        </p>
      </div>
    );
  }

  const [openBlockerRows, agentRows] = await Promise.all([
    db
      .select({
        id: blockers.id,
        reason: blockers.reason,
        helpNeeded: blockers.helpNeeded,
        projectId: projects.id,
        projectName: projects.name,
        raisedByName: users.name,
        raisedById: blockers.raisedById,
        createdAt: blockers.createdAt,
      })
      .from(blockers)
      .innerJoin(projects, eq(blockers.projectId, projects.id))
      .leftJoin(users, eq(blockers.raisedById, users.id))
      .where(and(eq(blockers.status, "open"), inArray(projects.teamId, teamIds)))
      .orderBy(desc(blockers.createdAt)),
    db
      .select({
        userId: agents.userId,
        name: users.name,
        provider: agents.provider,
        status: agents.status,
        lastSeenAt: agents.lastSeenAt,
      })
      .from(agents)
      .innerJoin(users, eq(agents.userId, users.id))
      .where(inArray(agents.teamId, teamIds))
      .orderBy(users.name),
  ]);

  // 自己发的不算「待我帮忙」
  const needingHelp = openBlockerRows.filter((b) => b.raisedById !== session.user.id);

  return (
    <div className="mx-auto max-w-[80rem] space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">协作</h1>
        <p className="mt-1 text-sm text-ink-2">
          {needingHelp.length === 0
            ? "眼下没有人在等搭手。"
            : `${needingHelp.length} 件事在等人搭手。`}
        </p>
      </header>

      <section className="ac-card overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">等人搭手</h2>
          <p className="text-xs text-ink-3">卡住的活不会自己变好</p>
        </header>
        {needingHelp.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-2">没有未解决的求助。</p>
        ) : (
          <ul className="divide-y divide-stroke">
            {needingHelp.map((b) => (
              <li key={b.id} className="px-4 py-3">
                <p className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium text-ink">{b.raisedByName ?? "已注销成员"}</span>
                  <span className="text-ink-3">在</span>
                  <Link
                    href={`/projects/${b.projectId}?space=live`}
                    className="rounded-[var(--radius-control)] text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                  >
                    {b.projectName}
                  </Link>
                  <span className="text-ink-3">求助</span>
                </p>
                {b.helpNeeded && (
                  <p className="mt-1 text-xs leading-5 text-ink-2">需要：{b.helpNeeded}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ac-card overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">AI 成员</h2>
          <p className="text-xs text-ink-3">它们也是团队成员，只是干活的方式不同</p>
        </header>
        {agentRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-2">
            还没有 AI 成员。到团队的「管理 AI 成员」注册一个。
          </p>
        ) : (
          <ul className="divide-y divide-stroke">
            {agentRows.map((a) => {
              const tone =
                a.status === "idle"
                  ? { label: "空闲", cls: "bg-human-soft text-human" }
                  : a.status === "working"
                    ? { label: "干活中", cls: "bg-signal-soft text-signal" }
                    : a.status === "blocked"
                      ? { label: "卡住了", cls: "bg-risk-soft text-risk" }
                      : a.status === "error"
                        ? { label: "出错", cls: "bg-risk-soft text-risk" }
                        : { label: "离线", cls: "bg-sunken text-ink-3" };
              return (
                <li
                  key={a.userId}
                  className="flex flex-wrap items-baseline gap-2 px-4 py-3 text-sm"
                >
                  <span className="font-medium text-ink">{a.name}</span>
                  <span className="ac-agent-mark">协作者</span>
                  <span className={`ac-badge ${tone.cls}`}>{tone.label}</span>
                  <span className="text-xs text-ink-3">{a.provider}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
