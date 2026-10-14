import { db } from "@/db";
import { taskTreeDrafts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTaskTree, taskTreePayloadSchema, type TaskTreePayload } from "@/lib/task-tree";
import { listTeamMembers } from "@/lib/team";
import { getProjectPerspective } from "@/lib/project-view";
import { emptyDraftPlan } from "@/lib/draft-planning";
import { TimelineTaskTrees, type TimelineTreeGroup } from "./timeline-task-trees";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectDependencies } from "@/lib/task";
import { statusLabel } from "@/lib/task-status";


export default async function TimelinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { role, viewUserId, preview } = await getProjectPerspective(access.role, projectId, session.user.id, access.project.teamId);
  const [tree, dependencies, published, members] = await Promise.all([
    getTaskTree(session.user.id, projectId), listProjectDependencies(session.user.id, projectId),
    db.select({ id: taskTreeDrafts.id, briefId: taskTreeDrafts.briefId, payload: taskTreeDrafts.payload }).from(taskTreeDrafts).where(and(eq(taskTreeDrafts.projectId, projectId), eq(taskTreeDrafts.status, "published"))),
    listTeamMembers(access.project.teamId),
  ]);
  const publishedDrafts = published.map(draft => ({ ...draft, payload: taskTreePayloadSchema.parse(draft.payload) }));
  const groups: TimelineTreeGroup[] = [];
  const deliveryByTask = new Map<string, (typeof tree.deliveries)[number]>();
  for (const delivery of tree.deliveries) if (!deliveryByTask.has(delivery.taskId)) deliveryByTask.set(delivery.taskId, delivery);
  const stageGroups = [...tree.stages, ...(tree.tasks.some(task => !task.stageId) ? [{ id: "unassigned-stage", title: "未归入阶段的任务", sourceBriefId: null }] : [])];
  for (const stage of stageGroups) {
    const rows = tree.tasks.filter(task => stage.id === "unassigned-stage" ? !task.stageId : task.stageId === stage.id);
    if (!rows.length) continue;
    const keys = new Set(rows.map(task => task.id));
    const payload: TaskTreePayload = { summary: stage.title, stages: [{ title: stage.title, tasks: rows.map(task => ({ key: task.id, parentKey: task.parentTaskId && keys.has(task.parentTaskId) ? task.parentTaskId : null, title: task.title, description: task.description ?? "", assigneeId: task.id, priority: task.priority, doneCriteria: Array.isArray(task.doneCriteria) ? task.doneCriteria.filter((value): value is string => typeof value === "string") : [] })) }] };
    const links = emptyDraftPlan(payload).stages[0].links.map(link => ({ ...link, afterKeys: dependencies.filter(edge => edge.successorId === link.key && tree.tasks.some(task => task.id === edge.predecessorId)).map(edge => edge.predecessorId), reason: "项目中设置的任务后续关系" }));
    const draft = publishedDrafts.find(item => item.briefId === stage.sourceBriefId);
    const draftStageIndex = tree.stages.filter(item => item.sourceBriefId === stage.sourceBriefId).findIndex(item => item.id === stage.id);
    groups.push({ id: stage.id, title: stage.title, payload, pending: false, links, draftId: draft?.id, draftStageIndex, details: rows.map(task => {
      const delivery = deliveryByTask.get(task.id);
      return { key: task.id, taskId: task.id, status: statusLabel(task.status), owner: task.assigneeName ?? "待分配", completed: task.status === "done", completionNote: task.completionNote, reviewNote: task.reviewNote, dueDate: task.dueDate,
        canDeliver: !preview && role !== "teacher" && !task.isTaskGroup && tree.stages.find(item => item.id === task.stageId)?.status === "active" && (role === "admin" || task.assigneeId === viewUserId),
        delivery: delivery ? { branchName: delivery.branchName, testSummary: delivery.testSummary, pullRequestUrl: delivery.pullRequestUrl } : null };
    }) });
  }
  const pendingDrafts = role === "admin" ? tree.drafts : [];
  for (const draft of pendingDrafts) draft.payload.stages.forEach((stage, index) => {
    const payload = { summary: draft.payload.summary, stages: [{ ...stage, tasks: stage.tasks.map(task => ({ ...task, assigneeId: task.key })) }] };
    groups.push({ id: `${draft.id}-${index}`, title: stage.title, payload, pending: true, draftId: draft.id, draftStageIndex: index, links: emptyDraftPlan(payload).stages[0].links, details: stage.tasks.map(task => ({ key: task.key, taskId: null, status: "待确认", owner: members.find(member => member.id === task.assigneeId)?.name ?? "待分配" })) });
  });


  const current = tree.stages.find(stage => stage.status === "active" || stage.status === "integrating");
  const currentTasks = tree.tasks.filter(task => current && task.stageId === current.id && !task.isTaskGroup);
  const complete = currentTasks.filter(task => task.status === "done").length;
  return <main data-tour="timeline" className="space-y-6">
    <header><h2 className="text-xl font-semibold text-ink">时间线</h2><p className="mt-2 text-sm text-ink-3">查看当前阶段进度和项目任务树，点击任务打开详情。</p></header>
    <section data-tour="stage-progress" aria-label="项目阶段进度" className="grid gap-px overflow-hidden border border-stroke bg-stroke sm:grid-cols-3">
      <div className="bg-panel p-4"><p className="text-xs text-ink-3">当前阶段</p><p className="mt-2 font-semibold">{current?.title ?? (tree.stages.length ? "全部阶段已完成" : "等待规划")}</p><p className="mt-1 text-xs text-ink-3">{current?.status === "integrating" ? "待集成审核" : current ? "执行中" : "暂无执行中的阶段"}</p></div>
      <div className="bg-panel p-4"><p className="text-xs text-ink-3">当前阶段任务验收进度</p><p className="mt-2 text-xl tabular-nums">{complete}<span className="text-sm text-ink-3"> / {currentTasks.length}</span></p><progress aria-label="当前阶段已验收任务比例" className="mt-2 h-1.5 w-full accent-[var(--color-signal)]" value={complete} max={currentTasks.length || 1} /></div>
      <div className="bg-panel p-4"><p className="text-xs text-ink-3">待处理</p><p className="mt-2 text-sm">{role === "student" ? currentTasks.filter(task => task.assigneeId === viewUserId && task.status !== "done").length + " 项当前阶段我的未完成任务" : currentTasks.filter(task => task.status !== "done").length + " 项当前阶段未完成任务"}</p><p className="mt-2 text-xs text-ink-3">{tree.stages.filter(stage => stage.status === "completed").length} / {tree.stages.length} 个阶段已完成</p></div>
    </section>
    <TimelineTaskTrees projectId={projectId} projectName={access.project.name} canAnalyse={role === "admin"} groups={groups} drafts={[...publishedDrafts, ...pendingDrafts].map(draft => ({ id: draft.id, payload: draft.payload }))} />
  </main>;
}
