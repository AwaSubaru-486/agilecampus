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

  const [projectMilestones, projectTasks, members, dependencies, teamLabels, projectConversations] =
    await Promise.all([
      listProjectMilestones(session.user.id, projectId),
      listProjectTasks(session.user.id, projectId),
      listTeamMembers(project.teamId),
      listProjectDependencies(session.user.id, projectId),
      listTeamLabels(session.user.id, project.teamId),
      listProjectConversations(session.user.id, projectId),
    ]);

  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );
  // 「今日」在服务端按本地时区取 YYYY-MM-DD，随后仅作字符串比较
  const today = new Date().toLocaleDateString("sv-SE");
  const visibleTasks = applyFilters(projectTasks, filters, today);

  const canWrite = role === "admin" || role === "student";
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
    <main className="mx-auto max-w-6xl space-y-7 py-6 sm:py-8">
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

      <MilestoneSection
        projectId={projectId}
        milestones={projectMilestones}
        isAdmin={isAdmin}
      />

      <section id="board" className="scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">任务看板</h2>
            <p className="mt-0.5 text-xs text-ink-faint">拖动任务即可推进状态，常用信息保持在卡片表面。</p>
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
          members={members.map((m) => ({ id: m.id, name: m.name }))}
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
          }))}
          canWrite={canWrite}
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
