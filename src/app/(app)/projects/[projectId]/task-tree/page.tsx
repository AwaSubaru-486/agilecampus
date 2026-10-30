import { getProjectView } from "@/lib/project-view";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { getProjectForUser } from "@/lib/project";
import { getTaskTree } from "@/lib/task-tree";
import { listTeamMembers } from "@/lib/team";
import { BriefForm } from "./task-tree-forms";
import { getTutorialProgress } from "@/lib/tutorials/progress";
import { DraftEditor } from "./draft-editor";
export default async function TaskTreePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const role = await getProjectView(access.role, projectId, session.user.id, access.project.teamId);
  if (role !== "admin" || query.plan !== "1") redirect("/projects/" + projectId + "/timeline");
  const [tree, members, tutorialProgress] = await Promise.all([getTaskTree(session.user.id, projectId), listTeamMembers(access.project.teamId), getTutorialProgress(session.user.id)]);
  const isTutorial = tutorialProgress.journey?.version === 5 && tutorialProgress.journey.projectId === projectId;
  const canManage = true;
  return (<div className="space-y-6"><header><h2 className="text-xl font-semibold text-ink">项目规划与分工</h2></header>
      {canManage && (
        <details id="planning" open={query.plan === "1" || !tree.stages.length} className="ac-disclosure scroll-mt-28">
          <summary><span className="text-base font-semibold text-ink">规划下一轮任务</span><span className="mt-1 block text-xs font-normal text-ink-3">说明目标 → 生成草案 → 调整分工 → 确认发布</span></summary>
          <div className="ac-disclosure-body"><p className="mb-5 text-sm text-ink-3">填写目标、交付要求或需求变化。已有任务会保留，新阶段追加在后。</p><BriefForm projectId={projectId} tutorial={isTutorial} generated={tree.drafts.length > 0 || tree.stages.length > 0}/></div>
        </details>
      )}
      <div data-tour="task-drafts" data-tour-complete={tree.stages.length > 0 ? "true" : "false"} className="space-y-4">
      {tree.drafts.length === 0 && canManage && <p className="border border-dashed border-stroke p-5 text-sm text-ink-soft">暂无待确认草案。生成后可在这里修订分工与完成标准，保存后确认发布。</p>}
      {tree.drafts.map((draft) => (
        <section
          key={draft.id}
          className="border border-signal/40 bg-panel p-5"
        >
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">
              待确认草案
            </h2>
            <span className="text-xs text-ink-soft">
              {draft.payload.stages.length} 个阶段 ·{" "}
              {draft.payload.stages.reduce(
                (count, stage) => count + stage.tasks.length,
                0,
              )}{" "}
              个任务
            </span>
          </div>
          {canManage ? (
            <DraftEditor tutorial={isTutorial}
              projectId={projectId}
              draftId={draft.id}
              payload={draft.payload}
              members={members.filter((member) => member.role !== "teacher")}
            />
          ) : (
            <div className="space-y-3 text-sm text-ink-soft">
              <p>{draft.payload.summary}</p>
              {draft.payload.stages.map((stage, index) => (
                <div key={index}>
                  <h3 className="font-semibold text-ink">{stage.title}</h3>
                  <ul className="mt-1 space-y-1">
                    {stage.tasks.map((task) => (
                      <li key={task.key}>
                        {task.title} ·{" "}
                        {members.find((member) => member.id === task.assigneeId)
                          ?.name ?? "待分配"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-xs">等待组长确认发布。</p>
            </div>
          )}
        </section>
      ))}
      </div>
    </div>
  );
}
