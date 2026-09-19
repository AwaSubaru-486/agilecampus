import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { parseFilters } from "@/lib/board-filters";
import { parseProjectSpace, spaceForConversationParams } from "@/lib/project-space";
import { listTaskRefs } from "@/lib/task";
import { ProjectBand } from "../../_shell/top-workbar";
import { SpaceTabs } from "./_shared/space-tabs";
import { LiveSpace } from "./_live/live-space";
import { WorkSpace } from "./_work/work-space";
import { StudioSpace } from "./_studio/studio-space";
import { RecordSpace } from "./_record/record-space";

// 项目页：四个互斥模式。
//
// 旧版是一根纵向长条——概览 → 工作现场 → 健康度 → 求助 → 看板 →
// 档案 → 对话，什么都往下堆，一屏装不下就往下滚。
//
// 四模式把「同一个项目的四种看法」分开，一次只渲染一个。这不只是
// 排版问题：每个 space 各自取数，打开「现场」不去查任务明细，
// 打开「工作」不去读会话历史。
//
// 参数全部走 URL（`space` / `task` / `conversation` 与筛选项），
// 可复制、可刷新、可前进后退。

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
  const actorId = session.user.id;

  // 带了 conversation 就必然落到协同室——否则「点了一条会话链接
  // 却停在现场」会变成一桩悬案（见 lib/project-space.ts）
  const requested = parseProjectSpace(sp.space);
  const conversationId = typeof sp.conversation === "string" ? sp.conversation : null;
  const space = spaceForConversationParams(requested, Boolean(conversationId));
  const taskId = typeof sp.task === "string" ? sp.task : undefined;

  const canWrite = role === "admin" || role === "student";

  // 上下文带要显示最近一个未完成的里程碑。这一条查询很小，
  // 且四个模式都要用（带子本来就是全局的），故在页面层查。
  const milestones = await listProjectMilestones(actorId, projectId);
  const latestOpen = milestones.find((m) => m.status === "open") ?? null;

  // 只在现场模式查接力链要的那四列。其余模式查了就是白费——
  // 按需加载的要点在这里，不在「少渲染几个组件」
  const relayTasks = space === "live" ? await listTaskRefs(projectId) : [];

  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );

  return (
    <div className="space-y-4">
      <ProjectBand
        projectName={project.name}
        latestMilestone={
          latestOpen
            ? `${latestOpen.title}${latestOpen.targetDate ? ` · ${latestOpen.targetDate}` : ""}`
            : milestones.length > 0
              ? "里程碑已全部达成"
              : null
        }
        spaces={<SpaceTabs projectId={projectId} current={space} taskId={taskId} />}
      />

      {space === "live" && (
        <LiveSpace
          actorId={actorId}
          projectId={projectId}
          isAdmin={role === "admin"}
          relayTasks={relayTasks}
        />
      )}

      {space === "work" && (
        <WorkSpace
          actorId={actorId}
          projectId={projectId}
          teamId={project.teamId}
          role={role}
          filters={filters}
        />
      )}

      {space === "studio" && (
        <StudioSpace
          actorId={actorId}
          projectId={projectId}
          teamId={project.teamId}
          selectedConversationId={conversationId}
        />
      )}

      {space === "record" && (
        <RecordSpace actorId={actorId} projectId={projectId} role={role} canWrite={canWrite} />
      )}
    </div>
  );
}

