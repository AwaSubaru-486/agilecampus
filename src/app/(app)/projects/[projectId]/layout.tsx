import { getProjectPerspective } from "@/lib/project-view";
import { ProjectViewSwitch } from "./_shared/project-view-switch";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { ProjectNavigation } from "./_shared/project-navigation";
import { DeleteProjectButton } from "./_shared/delete-project-button";
import { TeacherEvaluationModal } from "./_shared/teacher-evaluation-modal";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const milestones = await listProjectMilestones(session.user.id, projectId);
  const { project, role: actualRole } = access;
  const perspective = await getProjectPerspective(actualRole, projectId, session.user.id, project.teamId);
  const { role, delegated, viewUserName } = perspective;
  const next = milestones.find((m) => m.status === "open");
  return (
    <div className="ac-project-workspace">
      <header className="ac-project-heading">
        <div className="mb-5 flex items-center gap-2 text-xs text-ink-3">
          <Link href="/projects" className="hover:text-signal">
            我的项目
          </Link>
          <span>/</span>
          <span>
            {role === "admin" ? "组长" : role === "teacher" ? "导师" : "组员"}
            工作区
          </span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {project.name}
            </h1>
            <p className="mt-3 text-sm text-ink-3">
              {next
                ? `下一里程碑：${next.title}${next.targetDate ? `，${next.targetDate}` : ""}`
                : role === "admin"
                  ? "规划与分工，推进每一轮交付。"
                  : role === "teacher"
                    ? "从成果证据出发，给出审核与指导。"
                    : "明确完成要求，接下任务并交付成果。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actualRole === "admin" && <ProjectViewSwitch projectId={projectId} view={role} selection={perspective.selection} members={perspective.members} leaderName={session.user.name ?? "组长"} />}
            {role === "teacher" && (
              <TeacherEvaluationModal
                projectId={projectId}
                projectName={project.name}
                role={role}
                milestones={milestones.map((m) => ({
                  id: m.id,
                  title: m.title,
                  targetDate: m.targetDate,
                  status: m.status,
                }))}
              />
            )}
            <details className="ac-context-menu">
              <summary className="ac-btn-ghost">
                团队与项目 <span aria-hidden>⌄</span>
              </summary>
              <div className="ac-context-menu-panel">
                <p className="px-3 py-2 text-xs text-ink-3">
                  需要成员、资源或配置时
                </p>
                <Link href={`/teams/${project.teamId}/members`}>
                  成员与角色
                </Link>
                <Link href={`/teams/${project.teamId}/resources`}>
                  共享资源
                </Link>
                {role === "admin" && <Link href={`/teams/${project.teamId}/labels`}>团队标签</Link>}
                {role === "admin" && <Link href={`/teams/${project.teamId}/agents`}>
                  AI 成员与连接
                </Link>}

              </div>
            </details>
            {role === "admin" && <DeleteProjectButton projectId={projectId} projectName={project.name} />}
          </div>
        </div>
      </header>
      <ProjectNavigation projectId={projectId} role={role} />
      <div className="ac-project-body">{delegated && <p role="status" className="mb-5 rounded-xl border border-signal/20 bg-signal-soft p-4 text-sm text-ink-2">当前以{viewUserName}的{role === "student" ? "组员" : "老师"}视角操作。{role === "student" ? "可以直接提交本人任务和交付材料。" : "可以复核组长已审核的成果和审核阶段集成。"}操作将实际保存，并记录由组长代操作；登录账号和团队角色保持原样。</p>}<div className="min-w-0">{children}</div></div>
    </div>
  );
}
