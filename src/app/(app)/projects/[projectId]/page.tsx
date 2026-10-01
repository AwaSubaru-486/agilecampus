import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { parseFilters } from "@/lib/board-filters";
import { normalizeConsoleParams, needsRedirect, serializeConsoleParams } from "@/lib/console-navigation";
import { listTaskRefs } from "@/lib/task";
import { ProjectBand } from "../../_shell/top-workbar";
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
//
// W01 变更：
//   - 使用 normalizeConsoleParams 统一归一化（live→work，非法→work，
//     带 conversation/approval→studio），幂等，不产生重定向循环。
//   - ?task= 只用于查看，不再自动打开编辑框（task-card.tsx 已修）。
//   - page.tsx 不再挂全局 TaskDrawer（执行台自身负责详情层，避免叠层）。
//   - live 模式保留，通过概览标签进入；只是默认进入时不再首先显示它。

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

  // 归一化所有参数：live→work，非法→work，带会话/审批→studio。
  // 数组参数取第一项；规范化结果幂等，不产生重定向循环。
  const rawParams = Object.fromEntries(
    Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v ?? null]),
  );
  const normalized = normalizeConsoleParams(rawParams);
  const { space, task: taskId, conversation: conversationId, approval: approvalId } = normalized;

  // 地址栏与规范化结果不一致时服务端 redirect，确保复制/刷新/前进后退正确。
  if (needsRedirect(rawParams, normalized)) {
    redirect(`/projects/${projectId}?${serializeConsoleParams(normalized)}`);
  }

  const canWrite = role === "admin" || role === "student";

  // 里程碑：小查询，四个模式都要用（面包带子是全局的）。
  const milestones = await listProjectMilestones(actorId, projectId);
  const latestOpen = milestones.find((m) => m.status === "open") ?? null;

  // 接力链只在现场模式需要，按需加载。
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
            ? `${latestOpen.title}${latestOpen.targetDate ? `；截止：${latestOpen.targetDate}` : ""}`
            : milestones.length > 0
              ? "里程碑已全部达成"
              : null
        }
        backHref="/projects"
        backLabel="所有项目"
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
          selectedTaskId={taskId}
          view={typeof sp.view === "string" ? sp.view : null}
          normalized={normalized}
        />
      )}

      {space === "studio" && (
        <StudioSpace
          actorId={actorId}
          projectId={projectId}
          teamId={project.teamId}
          selectedConversationId={conversationId}
          selectedTaskId={taskId}
          selectedApprovalId={approvalId}
        />
      )}

      {space === "record" && (
        <RecordSpace actorId={actorId} projectId={projectId} role={role} canWrite={canWrite} />
      )}

      {/* TaskDrawer 已移除：执行台（WorkSpace）负责详情层，避免与旧卡片编辑框叠层。
          studio/record 各自承载自己的详情 overlay。
          旧 ?task= 深链仍有效——WorkSpace 会读取 selectedTaskId 并在中央展示详情。 */}
    </div>
  );
}
