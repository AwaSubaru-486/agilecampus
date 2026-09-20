import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, agentRuns, evidenceItems, tasks, users } from "@/db/schema";
import { buildContributionReport } from "@/lib/contribution";
import { listMilestoneProgress } from "@/lib/milestone";
import { getProjectForUser } from "@/lib/project";
import { listProjectEntries, type EntryRow } from "@/lib/entry";
import { ForbiddenError } from "@/lib/errors";
import { STATUS_LABEL, type TaskStatus } from "@/lib/task-status";

/**
 * 项目档案导出只读取公开项目数据：任务、证据、档案、里程碑、活动和贡献统计。
 * 不读取 messages/conversations，因而不会把私人会话、token 或隐藏 prompt 带出项目。
 */
export type ProjectExport = {
  schemaVersion: "1.0";
  generatedAt: Date;
  privacy: {
    excluded: ["private_conversations", "tokens", "hidden_prompts"];
  };
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    startDate: string | null;
    endDate: string | null;
    createdAt: Date;
  };
  summary: {
    taskTotal: number;
    doneCount: number;
    evidenceCount: number;
    entryCount: number;
    activityCount: number;
    agentRunCount: number;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    description: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    handoffBrief: string | null;
    doneCriteria: unknown;
    requiredEvidence: unknown;
    commitmentNote: string | null;
    completionNote: string | null;
    reviewNote: string | null;
    dueDate: string | null;
    createdAt: Date;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    evidence: Array<{
      id: string;
      type: string;
      label: string;
      value: string;
      sourceId: string | null;
      submittedById: string | null;
      createdAt: Date;
    }>;
  }>;
  entries: EntryRow[];
  milestones: Awaited<ReturnType<typeof listMilestoneProgress>>;
  activity: Array<{
    id: string;
    type: string;
    summary: string | null;
    taskId: string | null;
    actorId: string | null;
    actorName: string | null;
    actorKind: "human" | "agent" | null;
    createdAt: Date;
  }>;
  contributions: Awaited<ReturnType<typeof buildContributionReport>>;
  aiParticipation: Array<{
    runId: string;
    taskId: string | null;
    taskTitle: string | null;
    agentId: string;
    agentName: string | null;
    status: string;
    error: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
  }>;
};

export async function buildProjectExport(actorId: string, projectId: string): Promise<ProjectExport> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [taskRows, evidenceRows, entryRows, milestoneRows, activityRows, runRows, contributions] =
    await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          description: tasks.description,
          assigneeId: tasks.assigneeId,
          assigneeName: users.name,
          handoffBrief: tasks.handoffBrief,
          doneCriteria: tasks.doneCriteria,
          requiredEvidence: tasks.requiredEvidence,
          commitmentNote: tasks.commitmentNote,
          completionNote: tasks.completionNote,
          reviewNote: tasks.reviewNote,
          dueDate: tasks.dueDate,
          createdAt: tasks.createdAt,
          submittedAt: tasks.submittedAt,
          reviewedAt: tasks.reviewedAt,
        })
        .from(tasks)
        .leftJoin(users, eq(tasks.assigneeId, users.id))
        .where(eq(tasks.projectId, projectId))
        .orderBy(asc(tasks.createdAt)),
      db
        .select({
          id: evidenceItems.id,
          taskId: evidenceItems.taskId,
          type: evidenceItems.type,
          label: evidenceItems.label,
          value: evidenceItems.value,
          sourceId: evidenceItems.sourceId,
          submittedById: evidenceItems.submittedById,
          createdAt: evidenceItems.createdAt,
        })
        .from(evidenceItems)
        .where(eq(evidenceItems.projectId, projectId))
        .orderBy(asc(evidenceItems.createdAt)),
      listProjectEntries(actorId, projectId, { limit: 10_000 }),
      listMilestoneProgress(actorId, projectId),
      db
        .select({
          id: activityEvents.id,
          type: activityEvents.type,
          summary: activityEvents.summary,
          taskId: activityEvents.taskId,
          actorId: activityEvents.actorId,
          actorName: users.name,
          actorKind: users.kind,
          createdAt: activityEvents.createdAt,
        })
        .from(activityEvents)
        .leftJoin(users, eq(activityEvents.actorId, users.id))
        .where(eq(activityEvents.projectId, projectId))
        .orderBy(asc(activityEvents.createdAt)),
      db
        .select({
          runId: agentRuns.id,
          taskId: agentRuns.taskId,
          taskTitle: tasks.title,
          agentId: agentRuns.agentId,
          agentName: users.name,
          status: agentRuns.status,
          error: agentRuns.error,
          startedAt: agentRuns.startedAt,
          finishedAt: agentRuns.finishedAt,
          createdAt: agentRuns.createdAt,
        })
        .from(agentRuns)
        .innerJoin(tasks, eq(agentRuns.taskId, tasks.id))
        .leftJoin(users, eq(agentRuns.agentId, users.id))
        .where(eq(tasks.projectId, projectId))
        .orderBy(asc(agentRuns.createdAt)),
      buildContributionReport(actorId, projectId),
    ]);

  const evidenceByTask = new Map<string, ProjectExport["tasks"][number]["evidence"]>();
  for (const row of evidenceRows) {
    if (!row.taskId) continue;
    const list = evidenceByTask.get(row.taskId) ?? [];
    list.push({ ...row });
    evidenceByTask.set(row.taskId, list);
  }

  const tasksForExport = taskRows.map((task) => ({
    ...task,
    evidence: evidenceByTask.get(task.id) ?? [],
  }));

  return {
    schemaVersion: "1.0",
    generatedAt: new Date(),
    privacy: { excluded: ["private_conversations", "tokens", "hidden_prompts"] },
    project: {
      id: access.project.id,
      name: access.project.name,
      description: access.project.description,
      status: access.project.status,
      startDate: access.project.startDate,
      endDate: access.project.endDate,
      createdAt: access.project.createdAt,
    },
    summary: {
      taskTotal: tasksForExport.length,
      doneCount: tasksForExport.filter((task) => task.status === "done").length,
      evidenceCount: evidenceRows.length,
      entryCount: entryRows.length,
      activityCount: activityRows.length,
      agentRunCount: runRows.length,
    },
    tasks: tasksForExport,
    entries: entryRows,
    milestones: milestoneRows,
    activity: activityRows,
    contributions,
    aiParticipation: runRows,
  };
}

function dateText(value: Date | string | null | undefined) {
  if (!value) return "—";
  return value instanceof Date ? value.toISOString() : value;
}

function inline(value: unknown) {
  return String(value ?? "").replaceAll("\n", " ").trim();
}

export function renderProjectExportMarkdown(pack: ProjectExport) {
  const lines = [
    `# ${pack.project.name}｜项目档案`,
    "",
    `> 导出版本 ${pack.schemaVersion} · 生成于 ${dateText(pack.generatedAt)}`,
    "> 本档案只包含项目公开协作数据；私人会话、token、隐藏 prompt 永不导出。",
    "",
    "## 项目概览",
    "",
    `- 项目状态：${pack.project.status}`,
    `- 项目周期：${pack.project.startDate ?? "未设置"} ~ ${pack.project.endDate ?? "未设置"}`,
    `- 任务：${pack.summary.taskTotal} 项，已验收 ${pack.summary.doneCount} 项`,
    `- 证据：${pack.summary.evidenceCount} 条；档案：${pack.summary.entryCount} 条；活动：${pack.summary.activityCount} 条`,
    `- Agent 执行：${pack.summary.agentRunCount} 次（AI 参与记录，不等同于业务验收）`,
    pack.project.description ? `- 项目说明：${inline(pack.project.description)}` : "",
    "",
    "## 任务与证据",
    "",
  ];

  for (const task of pack.tasks) {
    lines.push(
      `### ${task.title}`,
      `- 状态：${STATUS_LABEL[task.status as TaskStatus] ?? task.status} · 负责人：${task.assigneeName ?? "未指派"}`,
      `- 截止：${task.dueDate ?? "未设置"} · 提交：${dateText(task.submittedAt)} · 验收：${dateText(task.reviewedAt)}`,
      task.handoffBrief ? `- 交接目标：${inline(task.handoffBrief)}` : "",
      task.commitmentNote ? `- 成员承诺：${inline(task.commitmentNote)}` : "",
      task.completionNote ? `- 完成说明：${inline(task.completionNote)}` : "",
      task.reviewNote ? `- 验收意见：${inline(task.reviewNote)}` : "",
    );
    if (task.evidence.length === 0) lines.push("- 证据：无");
    else {
      lines.push("- 证据：");
      for (const evidence of task.evidence) {
        lines.push(`  - [${evidence.type}] ${evidence.label}：${inline(evidence.value)}`);
      }
    }
    lines.push("");
  }

  lines.push("## 项目档案", "");
  for (const entry of pack.entries) {
    lines.push(
      `- **${entry.title}**（${entry.type}）${entry.url ? ` · ${entry.url}` : ""}`,
      entry.content ? `  - ${inline(entry.content)}` : "",
      `  - 记录于 ${dateText(entry.createdAt)} · 作者 ${entry.authorName ?? "未知"}`,
    );
  }
  if (pack.entries.length === 0) lines.push("暂无项目档案。");

  lines.push("", "## 里程碑与高光", "");
  for (const milestone of pack.milestones) {
    lines.push(
      `### ${milestone.title}`,
      `- 状态：${milestone.status === "done" ? "已达成" : "进行中"} · 目标：${milestone.targetDate ?? "未设置"}`,
      milestone.autoSummary ? `- 自动摘要：${inline(milestone.autoSummary)}` : "",
    );
    for (const highlight of milestone.highlights) {
      lines.push(`- ${highlight.note}${highlight.taskTitle ? `（${highlight.taskTitle}）` : ""}`);
    }
    lines.push("");
  }
  if (pack.milestones.length === 0) lines.push("暂无里程碑。", "");

  lines.push("## AI 参与记录", "");
  for (const run of pack.aiParticipation) {
    lines.push(
      `- ${run.agentName ?? run.agentId} → ${run.taskTitle ?? run.taskId ?? "未关联任务"}：${run.status}（${dateText(run.createdAt)}）${run.error ? `；错误：${inline(run.error)}` : ""}`,
    );
  }
  if (pack.aiParticipation.length === 0) lines.push("暂无 Agent 执行记录。");

  lines.push("", "## 贡献概览", "");
  for (const row of pack.contributions.rows) {
    lines.push(
      `- ${row.name}：验收通过 ${row.acceptedCount} · 提交 ${row.submittedCount} · 求助协作 ${row.helpedOthersCount} · 活跃 ${row.activeDays} 天`,
    );
  }
  lines.push("", "## 数据边界", "");
  if (pack.contributions.rows.length === 0) lines.push("暂无贡献记录。", "");
  lines.push("- 实际投入时长、线下贡献、工作质量和协作氛围不能仅凭系统数据准确推断。", "");

  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
}
