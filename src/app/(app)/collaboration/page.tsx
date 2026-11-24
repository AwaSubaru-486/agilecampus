import Link from "@/components/feedback-link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { agents, teamMembers, users } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listCollaborationHelp } from "@/lib/blocker";
import { groupTaskHelp } from "@/lib/collaboration-help";
import { getTaskDetail } from "@/lib/task";
import { statusLabel } from "@/lib/task-status";
import { BlockerStrip } from "../projects/[projectId]/blocker-strip";

// 协作中心：求助邀请与 AI 成员状态。
//
// 旧版没有这一页——求助散在各个项目里，AI 状态藏在项目页中部。
// 这里把它们提到一级导航，因为「谁在等搭手」「AI 在干什么」
// 是每天都要看一眼的事，不该埋进某个项目里找。
//
// 项目工作区承接任务和待确认动作；这里专注回答「谁卡住了」
// 和「AI 成员现在在干什么」，避免同一条审批在两个入口重复出现。
export default async function CollaborationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const query = await searchParams;
  const uuidParam = (value: unknown) => z.uuid().safeParse(value).success ? value as string : undefined;
  const projectFilter = uuidParam(query.project);
  const focusedTask = uuidParam(query.task);
  const focusedHelp = uuidParam(query.help);
  const focusAnchor = focusedTask ? `task-${focusedTask}` : focusedHelp ? `help-${focusedHelp}` : null;

  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, session.user.id));
  const teamIds = memberships.map((m) => m.teamId);

  if (teamIds.length === 0) {
    return (
      <div data-tour="collaboration" className="mx-auto max-w-[80rem]">
        <h1 className="font-display text-2xl font-bold text-ink">协作中心</h1>
        <p className="ac-card mt-4 p-8 text-center text-sm text-ink-2">
          你还没有加入任何团队。
        </p>
      </div>
    );
  }

  const [openBlockerRows, agentRows] = await Promise.all([
    listCollaborationHelp(session.user.id, projectFilter),
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

  const helpGroups = groupTaskHelp(openBlockerRows);
  const selectedGroup = helpGroups.find(group => group.anchor === focusAnchor);
  const selectedTask = selectedGroup?.taskId ? await getTaskDetail(session.user.id, selectedGroup.taskId) : null;
  const orderedGroups = [...helpGroups].sort((a, b) => Number(b.anchor === focusAnchor) - Number(a.anchor === focusAnchor));

  return (
    <div data-tour="collaboration" className="mx-auto max-w-[80rem] space-y-5">
      <header className="ac-page-header">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">协作中心</h1>
            <p>查看需要帮助的任务，协助解决具体求助。</p>
            <div className="mt-4 flex gap-4 text-xs text-ink-3">
              <span>需要帮助的任务 {helpGroups.filter(group => group.taskId).length}</span>
              <span>未解决求助 {openBlockerRows.length}</span>
              <span>我发起的 {openBlockerRows.filter((request) => request.raisedById === session.user.id).length}</span>
              <span>AI 成员 {agentRows.length}</span>
            </div>
          </div>
          <Link
            href="/projects"
            className="text-xs font-medium text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            查看我的项目 →
          </Link>
        </div>
      </header>

      <div className="flex justify-end"><Link href="/health" className="text-xs text-ink-3 hover:text-signal">查看跨项目风险 →</Link></div>
      {projectFilter && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stroke bg-panel p-4 text-sm"><p>正在查看项目内的求助。</p><Link href="/collaboration#help" className="text-signal">查看全部项目 →</Link></div>}
      {focusAnchor && !selectedGroup && <p role="status" className="rounded-xl border border-stroke bg-panel p-4 text-sm text-ink-3">这项求助已结束或当前不可见，可查看下方仍需帮助的任务。</p>}

      <section id="help" className="ac-card scroll-mt-20 overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">需要协助的任务与求助</h2>
          <span className="text-xs tabular-nums text-ink-3">{openBlockerRows.length} 条求助</span>
        </header>
        {helpGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-2">没有未解决的求助。</p>
        ) : (
          <ul className="divide-y divide-stroke">
            {orderedGroups.map(group => {
              const focused = group.anchor === focusAnchor;
              const first = group.requests[0];
              return <li id={group.anchor} key={group.anchor} className={`scroll-mt-28 p-4 ${focused ? "bg-signal-soft/40" : ""}`}>
                <details key={`${group.anchor}-${focused}`} open={focused}>
                  <summary className="cursor-pointer rounded-lg p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal">
                    <span className="font-semibold text-ink">{group.title}</span>
                    <span className="ml-3 text-xs text-ink-3">{first.projectName}，{group.requests.length} 条求助</span>
                    {focused && <span className="ml-3 text-xs text-signal">当前任务</span>}
                  </summary>
                  <div className="mt-3 space-y-4">
                    {focused && selectedTask && <section aria-label="求助任务详情" className="rounded-xl border border-stroke bg-panel p-4 text-sm">
                      <p className="text-ink-3">负责人：{selectedTask.assigneeName ?? "待分配"}，{statusLabel(selectedTask.status)}</p>
                      <h3 className="mt-3 font-semibold">任务目标</h3><p className="mt-2 whitespace-pre-wrap leading-6">{selectedTask.description || selectedTask.handoffBrief || "暂无执行说明"}</p>
                      {Array.isArray(selectedTask.doneCriteria) && selectedTask.doneCriteria.length > 0 && <><h3 className="mt-4 font-semibold">完成条件</h3><ul className="mt-2 list-inside list-disc space-y-1">{selectedTask.doneCriteria.filter((item): item is string => typeof item === "string").map((item, index) => <li key={index}>{item}</li>)}</ul></>}
                    </section>}
                    <BlockerStrip projectId={group.projectId} blockers={group.requests} />
                    <div className="flex flex-wrap gap-4 text-xs">
                      {group.taskId && <Link href={`/projects/${group.projectId}?space=work&scope=all&task=${group.taskId}`} className="text-signal">查看任务详情 →</Link>}
                      <Link href={`/projects/${group.projectId}`} className="text-ink-3">返回项目看板 →</Link>
                    </div>
                  </div>
                </details>
              </li>;
            })}
          </ul>
        )}
      </section>

      <section id="agents" className="ac-card scroll-mt-20 overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">AI 成员</h2>
          <span className="text-xs tabular-nums text-ink-3">{agentRows.length} 个</span>
        </header>
        {agentRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-2">
            暂无 AI 成员。到团队管理页注册。
          </p>
        ) : (
          <ul className="divide-y divide-stroke">
            {agentRows.map((a) => {
              const tone =
                a.status === "idle"
                  ? { label: "空闲", cls: "bg-human-soft text-human" }
                  : a.status === "working"
                    ? { label: "执行中", cls: "bg-signal-soft text-signal" }
                    : a.status === "blocked"
                      ? { label: "阻塞", cls: "bg-risk-soft text-risk" }
                      : a.status === "error"
                        ? { label: "出错", cls: "bg-risk-soft text-risk" }
                        : { label: "离线", cls: "bg-sunken text-ink-3" };
              return (
                <li
                  key={a.userId}
                  className="flex flex-wrap items-baseline gap-2 px-4 py-3 text-sm"
                >
                  <span className="font-medium text-ink">{a.name}</span>
                  <span className="ac-agent-mark">AI</span>
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
