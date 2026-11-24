import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { taskStages, stageIntegrations, taskDeliveries, tasks } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { listProjectDependencies, listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { listProjectBlockers } from "@/lib/blocker";
import { listTaskEvidence } from "@/lib/evidence";
import { AppError, ForbiddenError } from "@/lib/errors";
import { emptyByStatus, isAwaitingResponse } from "@/lib/task-status";
import { parseRequiredEvidence } from "@/lib/handoff";
import { today } from "@/lib/today";

export async function listProjectStages(actorId: string, projectId: string) {
  if (!await getProjectForUser(actorId, projectId)) throw new ForbiddenError();
  return db.select().from(taskStages).where(eq(taskStages.projectId, projectId)).orderBy(asc(taskStages.position));
}

export async function queryStageProgress(actorId: string, projectId: string) {
  if (!await getProjectForUser(actorId, projectId)) throw new ForbiddenError();
  const [stages, rows, integrations, deliveries] = await Promise.all([
    listProjectStages(actorId, projectId), listProjectTasks(actorId, projectId),
    db.select({ stageId: stageIntegrations.stageId, decision: stageIntegrations.decision, reviewNote: stageIntegrations.reviewNote })
      .from(stageIntegrations).where(inArray(stageIntegrations.stageId, db.select({ id: taskStages.id }).from(taskStages).where(eq(taskStages.projectId, projectId)))).orderBy(desc(stageIntegrations.createdAt), desc(stageIntegrations.id)),
    db.select({ taskId: taskDeliveries.taskId }).from(taskDeliveries)
      .where(inArray(taskDeliveries.taskId, db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)))),
  ]);
  const delivered = new Set(deliveries.map(row => row.taskId));
  const leaves = rows.filter(task => !task.isTaskGroup);
  const summary = stages.map(stage => {
    const stageTasks = leaves.filter(task => task.stageId === stage.id);
    const byStatus = emptyByStatus();
    stageTasks.forEach(task => byStatus[task.status]++);
    const integration = integrations.find(item => item.stageId === stage.id);
    return {
      id: stage.id, title: stage.title, position: stage.position, status: stage.status,
      taskTotal: stageTasks.length, acceptedTasks: byStatus.done, byStatus,
      remainingAcceptance: stageTasks.length - byStatus.done,
      missingDeliveryBranches: stageTasks.filter(task => !delivered.has(task.id)).length,
      integration: integration ?? null,
    };
  });
  return {
    currentStage: summary.find(stage => stage.status === "active" || stage.status === "integrating") ?? null,
    completedStages: summary.filter(stage => stage.status === "completed").length,
    stageTotal: stages.length, stages: summary,
    unassignedStageTasks: leaves.filter(task => !task.stageId).length,
    note: "验收进度按叶子任务计算；任务验收通过和阶段集成审核通过是两个关口。锁定阶段需要等待上一阶段集成通过。",
  };
}

export async function queryTeamWorkload(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const [members, rows, blockers] = await Promise.all([
    listTeamMembers(access.project.teamId), listProjectTasks(actorId, projectId),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
  ]);
  const leaves = rows.filter(task => !task.isTaskGroup);
  const day = today();
  return {
    actorId, actorRole: access.role,
    unassignedTasks: leaves.filter(task => !task.assigneeId).length,
    members: members.map(member => {
      const assigned = leaves.filter(task => task.assigneeId === member.id);
      const byStatus = emptyByStatus();
      assigned.forEach(task => byStatus[task.status]++);
      return {
        id: member.id, name: member.name, role: member.role,
        canExecute: member.role !== "teacher", taskTotal: assigned.length,
        unfinished: assigned.filter(task => task.status !== "done").length, byStatus,
        awaitingCommitment: assigned.filter(task => isAwaitingResponse(task.status, task.assigneeId, task.committedAt, task.committedHandoffVersion, task.handoffVersion)).length,
        overdue: assigned.filter(task => task.status !== "done" && task.dueDate && task.dueDate < day).length,
        openHelpRequests: blockers.filter(blocker => blocker.raisedById === member.id).length,
      };
    }),
    note: "工作量是任务数量，不能当作实际工时或能力评分。分工建议优先选择组员，老师负责复核。",
  };
}

export async function queryProjectHelp(actorId: string, projectId: string) {
  const rows = await listProjectBlockers(actorId, projectId, { status: ["open"] });
  return rows.map(row => ({ id: row.id, taskId: row.taskId, taskTitle: row.taskTitle, raisedById: row.raisedById,
    raisedByName: row.raisedByName, reason: row.reason, detail: row.detail, helpNeeded: row.helpNeeded, ageHours: row.ageHours }));
}

export async function getTaskContext(actorId: string, projectId: string, taskId: string) {
  // Verify the task in this project before reading evidence or dependencies.
  const rows = await listProjectTasks(actorId, projectId);
  const task = rows.find(row => row.id === taskId);
  if (!task) throw new AppError("任务不属于当前项目");
  const [stages, evidence, dependencies, deliveries, blockers] = await Promise.all([
    listProjectStages(actorId, projectId), listTaskEvidence(actorId, taskId), listProjectDependencies(actorId, projectId),
    db.select().from(taskDeliveries).where(eq(taskDeliveries.taskId, taskId)).orderBy(desc(taskDeliveries.createdAt), desc(taskDeliveries.id)).limit(1),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
  ]);
  const required = parseRequiredEvidence(task.requiredEvidence) ?? [];
  return {
    task: { id: task.id, title: task.title, description: task.description, status: task.status, priority: task.priority,
      assigneeId: task.assigneeId, assigneeName: task.assigneeName, dueDate: task.dueDate,
      handoffBrief: task.handoffBrief, doneCriteria: task.doneCriteria, requiredEvidence: required,
      commitmentNote: task.commitmentNote, completionNote: task.completionNote, reviewNote: task.reviewNote,
      awaitingCommitment: isAwaitingResponse(task.status, task.assigneeId, task.committedAt, task.committedHandoffVersion, task.handoffVersion) },
    stage: stages.find(stage => stage.id === task.stageId) ?? null,
    prerequisites: dependencies.filter(edge => edge.successorId === taskId).map(edge => {
      const predecessor = rows.find(row => row.id === edge.predecessorId);
      return { id: edge.predecessorId, title: predecessor?.title, status: predecessor?.status };
    }),
    evidence: evidence.map(item => ({ id: item.id, type: item.type, label: item.label, value: item.value })),
    missingEvidence: required.filter(type => !evidence.some(item => item.type === type)),
    latestDelivery: deliveries[0] ?? null,
    help: blockers.filter(blocker => blocker.taskId === taskId).map(blocker => ({ id: blocker.id, helpNeeded: blocker.helpNeeded, detail: blocker.detail })),
    note: "仅表示网页登记的资料，不能声称已访问成果链接、运行代码或通过真实测试。验收决定由人作出。",
  };
}
