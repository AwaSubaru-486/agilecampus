import { getTaskTree } from "@/lib/task-tree";
import { IntegrationReviewForm, IntegrationSubmitForm } from "../task-tree/task-tree-forms";

export async function StageIntegrationPanel({ actorId, viewUserId = actorId, projectId, role, canAct = true }: { actorId: string; viewUserId?: string; projectId: string; role: "admin" | "teacher"; canAct?: boolean }) {
  const tree = await getTaskTree(actorId, projectId);
  const stages = tree.stages.filter(stage => role === "teacher" ? stage.status === "integrating" || tree.integrations.some(item => item.stageId === stage.id) : stage.status !== "locked");
  return <section data-tour="stage-tasks" className="space-y-4" aria-label="阶段集成审核"><header><h2 className="text-lg font-semibold">阶段集成审核</h2><p className="mt-1 text-sm text-ink-3">在同一工作区检查任务成果和阶段集成材料。</p></header>
    {!stages.length && <p className="border border-stroke p-6 text-sm text-ink-3">暂无阶段集成提交。组长提交后会显示在这里。</p>}
    {stages.map(stage => { const integration = tree.integrations.find(item => item.stageId === stage.id); const leaves = tree.tasks.filter(task => task.stageId === stage.id && !task.isTaskGroup); const pendingTasks = leaves.filter(task => task.status !== "done").length; const missing = leaves.filter(task => !tree.deliveries.some(item => item.taskId === task.id)).length;
      return <article id={`stage-${stage.id}`} key={stage.id} className="ac-card p-5"><h3 className="font-semibold">阶段 {tree.stages.findIndex(item => item.id === stage.id) + 1}：{stage.title}</h3>
        {integration ? <div className="mt-3 space-y-2 text-sm"><p className="break-all">集成分支：{integration.branchName}{integration.headSha ? `，提交 ${integration.headSha.slice(0, 10)}` : ""}</p><p className="whitespace-pre-wrap leading-6">{integration.testSummary || "暂无测试摘要"}</p>{integration.reviewNote && <p>审核意见：{integration.reviewNote}</p>}<p className="text-xs text-ink-3">{integration.decision === "pending" ? "待审核" : integration.decision === "accepted" ? "审核通过" : "已退回"}</p>
          {stage.status === "integrating" && integration.decision === "pending" && integration.submittedById !== viewUserId && canAct && <IntegrationReviewForm projectId={projectId} integrationId={integration.id} />}
          {integration.decision === "pending" && integration.submittedById === viewUserId && <p className="text-xs text-ink-3">请由另一位组长或老师审核本次集成。</p>}
        </div> : null}
        {role === "admin" && stage.status === "active" && (leaves.length && !pendingTasks && !missing && canAct ? <div className="mt-4"><IntegrationSubmitForm projectId={projectId} stageId={stage.id} /></div> : <p className="mt-3 text-sm text-ink-3">集成前还需完成 {pendingTasks} 项任务验收、登记 {missing} 项交付分支。</p>)}
      </article>;
    })}
  </section>;
}
