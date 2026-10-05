import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { getProjectForUser } from "@/lib/project";
import { getTaskTree } from "@/lib/task-tree";
import { listTeamMembers } from "@/lib/team";
import { BriefForm, DeliveryForm, DraftActions, IntegrationReviewForm, IntegrationSubmitForm } from "./task-tree-forms";

const stageLabels = { locked: "未解锁", active: "进行中", integrating: "待集成审核", completed: "已完成" } as const;
const taskLabels = { todo: "待办", doing: "进行中", review: "待验收", done: "已完成" } as const;

export default async function TaskTreePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const [tree, members] = await Promise.all([
    getTaskTree(session.user.id, projectId),
    listTeamMembers(access.project.teamId),
  ]);
  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  const canManageTree = access.role === "admin";
  const canReview = access.role === "admin" || access.role === "teacher";
  const latestIntegrations = new Map<string, (typeof tree.integrations)[number]>();
  for (const integration of tree.integrations) if (!latestIntegrations.has(integration.stageId)) latestIntegrations.set(integration.stageId, integration);
  const latestDeliveries = new Map<string, (typeof tree.deliveries)[number]>();
  for (const delivery of tree.deliveries) if (!latestDeliveries.has(delivery.taskId)) latestDeliveries.set(delivery.taskId, delivery);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stroke pb-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-xs text-ink-faint hover:text-ink">返回项目</Link>
          <h1 className="mt-1 font-display text-xl font-semibold text-ink">任务树</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">项目说明交给 AI 生成草案，确认后按层级并行执行；同级成果集成审核通过，才会解锁下一层。</p>
        </div>
        <Link href={`/projects/${projectId}?space=work`} className="ac-btn-ghost">打开协同执行</Link>
      </header>

      {tree.drafts.map((draft) => (
        <section key={draft.id} className="border border-signal/40 bg-signal/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-signal">待确认草案</p>
              <p className="mt-1 text-sm text-ink">{draft.payload.summary}</p>
              <p className="mt-1 text-xs text-ink-faint">{draft.payload.stages.length} 个阶段，{draft.payload.stages.reduce((n, stage) => n + stage.tasks.length, 0)} 个任务</p>
            </div>
            {canManageTree && <DraftActions projectId={projectId} draftId={draft.id} />}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {draft.payload.stages.map((stage, stageIndex) => (
              <div key={`${draft.id}-${stageIndex}`} className="border border-stroke bg-panel p-3">
                <p className="text-sm font-semibold text-ink">阶段 {stageIndex + 1} · {stage.title}</p>
                <ul className="mt-2 space-y-1.5">
                  {stage.tasks.map((task) => (
                    <li key={task.key} className="flex items-start justify-between gap-3 text-xs" style={{ paddingLeft: task.parentKey ? 16 : 0 }}>
                      <span className="text-ink">{task.parentKey ? "↳ " : ""}{task.title}</span>
                      <span className="shrink-0 text-ink-faint">{task.assigneeId ? memberNames.get(task.assigneeId) ?? "成员已变化" : "待分配"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}

      {canManageTree && <section className="border border-stroke bg-panel p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div><h2 className="font-display text-base font-semibold text-ink">提交新的项目说明</h2><p className="mt-1 text-xs text-ink-faint">新说明会基于当前任务树生成增量草案，不会覆盖历史任务。</p></div>
        </div>
        <BriefForm projectId={projectId} />
      </section>}

      <div className="space-y-3">
        {tree.stages.length === 0 ? (
          <section className="border border-dashed border-stroke p-8 text-center text-sm text-ink-faint">还没有任务树。提交项目说明后开始生成。</section>
        ) : tree.stages.map((stage, index) => {
          const stageTasks = tree.tasks.filter((task) => task.stageId === stage.id);
          const childIds = new Set(stageTasks.flatMap((task) => task.parentTaskId ? [task.parentTaskId] : []));
          const roots = stageTasks.filter((task) => !task.parentTaskId);
          const integration = latestIntegrations.get(stage.id);
          const leaves = stageTasks.filter((task) => !childIds.has(task.id));
          const readyToIntegrate = leaves.length > 0 && leaves.every((task) => task.status === "done" && latestDeliveries.has(task.id));
          return (
            <section key={stage.id} className="border border-stroke bg-panel">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke px-4 py-3">
                <div className="flex items-center gap-3"><span className="text-xs tabular-nums text-ink-faint">阶段 {index + 1}</span><h2 className="font-semibold text-ink">{stage.title}</h2><span className={`text-xs ${stage.status === "completed" ? "text-done" : stage.status === "active" ? "text-signal" : "text-ink-faint"}`}>{stageLabels[stage.status]}</span></div>
                <span className="text-xs text-ink-faint">{stageTasks.filter((task) => !childIds.has(task.id) && task.status === "done").length}/{stageTasks.filter((task) => !childIds.has(task.id)).length} 个执行任务已验收</span>
              </div>
              <div className="divide-y divide-stroke/70">
                {roots.map((root) => {
                  const renderTask = (task: typeof root, depth: number) => {
                    const nested = stageTasks.filter((child) => child.parentTaskId === task.id);
                    const delivery = latestDeliveries.get(task.id);
                    const mayDeliver = access.role === "admin" || task.assigneeId === session.user.id;
                    return <div key={task.id} className="px-4 py-3" style={{ marginLeft: depth * 20 }}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium text-ink">{task.title}</p>{task.description && <p className="mt-0.5 text-xs text-ink-soft">{task.description}</p>}</div><div className="flex items-center gap-2 text-xs"><span className="text-ink-faint">{task.assigneeName ?? "待分配"}</span><span className={task.status === "done" ? "text-done" : task.status === "review" ? "text-review" : "text-ink-faint"}>{taskLabels[task.status]}</span></div></div>{nested.length === 0 && stage.status === "active" && (delivery ? <p className="mt-2 text-xs text-ink-faint">交付：{delivery.branchName}{delivery.headSha ? ` · ${delivery.headSha.slice(0, 10)}` : ""}</p> : mayDeliver ? <DeliveryForm projectId={projectId} taskId={task.id} /> : null)}{nested.map((child) => renderTask(child, depth + 1))}</div>;
                  };
                  return renderTask(root, 0);
                })}
              </div>
              {stage.status === "active" && access.role !== "teacher" && <div className="border-t border-stroke px-4 py-3">{readyToIntegrate ? <IntegrationSubmitForm projectId={projectId} stageId={stage.id} /> : <p className="text-xs text-ink-faint">所有叶子任务通过验收并登记交付分支后，才能提交阶段集成审核。</p>}</div>}
              {stage.status === "integrating" && integration && canReview && <div className="border-t border-stroke px-4 py-3"><p className="mb-2 text-xs text-ink-faint">集成分支：{integration.branchName}{integration.headSha ? ` · ${integration.headSha.slice(0, 10)}` : ""}</p><IntegrationReviewForm projectId={projectId} integrationId={integration.id} /></div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
