import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { listTeamLabels } from "@/lib/label";
import {
  listConversationMessages,
  listProjectConversations,
} from "@/lib/agent/conversation";
import { parseFilters, applyFilters } from "@/lib/board-filters";
import { today } from "@/lib/today";
import { listProjectBlockers } from "@/lib/blocker";
import { getProjectHealth } from "@/lib/health";
import { listProjectAgents } from "@/lib/agent-member";
import { listBusyTaskIds } from "@/lib/agent-run";
import { BlockerStrip } from "./blocker-strip";
import { HealthPanel } from "./health-panel";
import { MilestoneSection } from "./milestone-section";
import { NewTaskForm } from "./new-task-form";
import { Board } from "./board";
import { ChatPanel } from "./chat-panel";
import { FilterBar } from "./filter-bar";
import { ProjectSummary } from "./project-summary";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;

  const [
    projectMilestones,
    projectTasks,
    members,
    dependencies,
    teamLabels,
    projectConversations,
    openBlockers,
  ] = await Promise.all([
    listProjectMilestones(session.user.id, projectId),
    listProjectTasks(session.user.id, projectId),
    listTeamMembers(project.teamId),
    listProjectDependencies(session.user.id, projectId),
    listTeamLabels(session.user.id, project.teamId),
    listProjectConversations(session.user.id, projectId),
    listProjectBlockers(session.user.id, projectId, { status: ["open"] }),
  ]);

  // 健康度单独取：它内部还会为阻塞类风险问一次协作推荐，
  // 塞进上面的 Promise.all 也只是并发，读起来反而更绕
  const health = await getProjectHealth(session.user.id, projectId);

  // 人机混排要用的两样东西：每个 agent 此刻的状态，与哪些任务正有 agent 在办。
  // 一并取回、一次传下去，免得卡片里逐个查。
  const [projectAgents, busyTaskIds] = await Promise.all([
    listProjectAgents(session.user.id, projectId),
    listBusyTaskIds(projectId),
  ]);
  const agentStatusById = Object.fromEntries(projectAgents.map((a) => [a.userId, a.status]));

  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );
  // 「今日」在服务端按本地时区取 YYYY-MM-DD，随后仅作字符串比较
  const day = today();
  const visibleTasks = applyFilters(projectTasks, filters, day);

  // 两个能力并列而非包含：教师能验收，却仍不能编辑/拖拽/建任务。
  // 把 canReview 并进 canWrite 会一次性放开后者全部，那是另一回事。
  const canWrite = role === "admin" || role === "student";
  const canReview = role === "admin" || role === "teacher";
  const isAdmin = role === "admin";

  const selectedConversation = projectConversations[0] ?? null;
  const history = selectedConversation
    ? await listConversationMessages(session.user.id, selectedConversation.id)
    : [];
  const initialMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      authorName: m.authorName,
      sourceMessageId: m.sourceMessageId,
    }));

  return (
    <main className="mx-auto max-w-[82rem] space-y-7 py-1 sm:py-3">
      <ProjectSummary
        projectId={projectId}
        name={project.name}
        description={project.description}
        status={project.status}
        startDate={project.startDate}
        endDate={project.endDate}
        currentUserId={session.user.id}
        tasks={projectTasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          assigneeId: task.assigneeId,
          dueDate: task.dueDate,
        }))}
      />

      {/* 健康度紧跟概览：它是「这个项目怎么了」的一句话回答，
          也是开题报告里那个「把隐性问题变成可见对象」的正面落点 */}
      <HealthPanel projectId={projectId} health={health} />

      {/* 求助条置于看板之上：有人卡住是当下最该被看见的事，
          沉到页面底部等于没提 */}
      <BlockerStrip
        projectId={projectId}
        blockers={openBlockers.map((b) => ({
          id: b.id,
          taskId: b.taskId,
          taskTitle: b.taskTitle,
          raisedByName: b.raisedByName,
          reason: b.reason,
          detail: b.detail,
          helpNeeded: b.helpNeeded,
          ageHours: b.ageHours,
        }))}
      />

      <MilestoneSection
        projectId={projectId}
        milestones={projectMilestones}
        isAdmin={isAdmin}
      />

      <section id="board" className="scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-primary">EXECUTION</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-ink">任务流</h2>
            <p className="mt-1 text-xs text-ink-faint">拖动卡片推进任务；只有需要的信息才会留在表面。</p>
          </div>
          <a href="#quick-task" className="ac-btn px-3 py-2 text-sm">＋ 添加任务</a>
        </div>
        {canWrite && (
          <NewTaskForm
            projectId={projectId}
            members={members}
            milestones={projectMilestones.map((m) => ({ id: m.id, title: m.title }))}
          />
        )}
        <FilterBar
          members={members.map((m) => ({ id: m.id, name: m.kind === "agent" ? `${m.name}（AI）` : m.name }))}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          labels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          visible={visibleTasks.length}
          total={projectTasks.length}
        />
        <Board
          projectId={projectId}
          groupBy={filters.group}
          tasks={visibleTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            completionNote: t.completionNote,
            status: t.status,
            priority: t.priority,
            startDate: t.startDate,
            dueDate: t.dueDate,
            assigneeName: t.assigneeName,
            assigneeId: t.assigneeId,
            milestoneId: t.milestoneId,
            labels: t.labels,
            commitmentNote: t.commitmentNote,
            estimatedHours: t.estimatedHours,
            reviewNote: t.reviewNote,
            committedAt: t.committedAt,
            declineReason: t.declineReason,
            // 按任务预先算好，免得把整张状态表穿过三层组件；
            // 一个任务至多一个负责人，故这里一个字段就够
            agentStatus: t.assigneeId ? (agentStatusById[t.assigneeId] ?? null) : null,
            hasActiveRun: busyTaskIds.has(t.id),
          }))}
          canWrite={canWrite}
          canReview={canReview}
          currentUserId={session.user.id}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
          allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          dependencies={dependencies}
        />
      </section>

      <ChatPanel
        projectId={projectId}
        currentUserId={session.user.id}
        initialConversations={projectConversations.map((conversation) => ({
          ...conversation,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
        }))}
        initialConversationId={selectedConversation?.id ?? null}
        initialMessages={initialMessages}
        members={members}
        milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
        tasks={projectTasks.map((task) => ({ id: task.id, name: task.title }))}
      />
    </main>
  );
}
