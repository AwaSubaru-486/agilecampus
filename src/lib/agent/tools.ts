import { tool } from "ai";
import { z } from "zod";
import { listMyProjects, listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { TASK_STATUSES, emptyByStatus } from "@/lib/task-status";
import type { TaskStatus } from "@/db/schema";
import { EVIDENCE_TYPES, MAX_DONE_CRITERIA } from "@/lib/handoff";
import { queryStageProgress, queryTeamWorkload, queryProjectHelp, getTaskContext } from "./project-context";
import { listApprovalRequests } from "@/lib/approval";

// 读工具纯函数：权限经底层 lib（listProjectMilestones/listProjectTasks 内部各调 getProjectForUser）
export async function queryProgress(actorId: string, projectId: string) {
  const [ms, ts] = await Promise.all([
    listProjectMilestones(actorId, projectId),
    listProjectTasks(actorId, projectId),
  ]);
  // 显式标注 Record<TaskStatus, number> 与 emptyByStatus 并用：前者保编译期穷尽检查，后者保键随枚举走
  const byStatus: Record<TaskStatus, number> = emptyByStatus();
  const leaves = ts.filter(task => !task.isTaskGroup);
  for (const t of leaves) byStatus[t.status]++;
  return {
    taskTotal: leaves.length,
    byStatus,
    milestoneTotal: ms.length,
    milestones: ms.map((m) => ({
      title: m.title,
      status: m.status,
      targetDate: m.targetDate,
    })),
  };
}

export async function listTasksFiltered(
  actorId: string,
  projectId: string,
  filters: { status?: TaskStatus; assigneeId?: string; dueBefore?: string; stageId?: string; query?: string },
) {
  let list = await listProjectTasks(actorId, projectId);
  if (filters.status) list = list.filter((t) => t.status === filters.status);
  if (filters.assigneeId) list = list.filter((t) => t.assigneeId === filters.assigneeId);
  if (filters.stageId) list = list.filter(t => t.stageId === filters.stageId);
  if (filters.query) list = list.filter(t => (t.title + " " + (t.description ?? "")).toLowerCase().includes(filters.query!.toLowerCase()));
  if (filters.dueBefore)
    list = list.filter((t) => t.dueDate !== null && t.dueDate <= filters.dueBefore!);
  return list.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    assigneeName: t.assigneeName,
    assigneeId: t.assigneeId,
    stageId: t.stageId,
    isTaskGroup: t.isTaskGroup,
    handoffBrief: t.handoffBrief,
    doneCriteria: t.doneCriteria,
    requiredEvidence: t.requiredEvidence,
    responseDueAt: t.responseDueAt,
    contextPackId: t.contextPackId,
    handoffVersion: t.handoffVersion,
    committedHandoffVersion: t.committedHandoffVersion,
  }));
}

// 跨项目概览：裁去 createdAt 等模型用不上的字段，省 token
export async function listMyProjectsBrief(actorId: string) {
  const rows = await listMyProjects(actorId);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    teamName: p.teamName,
    taskTotal: p.taskTotal,
    doneCount: p.doneCount,
  }));
}

// 里程碑 id 兜底：快照超限降级后模型仍需 milestoneId
export async function listMilestonesBrief(actorId: string, projectId: string) {
  const rows = await listProjectMilestones(actorId, projectId);
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    targetDate: m.targetDate,
  }));
}

// AI SDK 工具装配：绑定 actorId/projectId，execute 委托纯函数
export function buildTools(actorId: string, projectId: string, conversationId?: string) {
  return {
    query_progress: tool({
      description: "查询该项目进度统计：各状态任务数、里程碑概况。无需参数。",
      inputSchema: z.object({}),
      execute: async () => queryProgress(actorId, projectId),
    }),
    query_stage_progress: tool({
      description: "查询当前执行阶段及各阶段叶子任务验收进度、锁定状态、未登记交付分支与集成审核结果。执行阶段与里程碑不同。",
      inputSchema: z.object({}), execute: async () => queryStageProgress(actorId, projectId),
    }),
    query_team_workload: tool({
      description: "查询本项目成员的真实角色、分配任务数、未完成数、未接住、逾期和求助数，用于回答我的任务、分工是否均匀和谁需要帮助。数量不代表工时。",
      inputSchema: z.object({}), execute: async () => queryTeamWorkload(actorId, projectId),
    }),
    list_help_requests: tool({
      description: "查询当前项目未解决的求助，返回谁需要帮助、关联任务、具体需求及等待时间。只读，不替用户发送求助。",
      inputSchema: z.object({}), execute: async () => queryProjectHelp(actorId, projectId),
    }),
    get_task_context: tool({
      description: "查看一项任务的执行说明、验收标准、当前阶段、前置任务、成果证据、缺失证据和交付分支。只反映登记资料，不代替人工验收。",
      inputSchema: z.object({ taskId: z.uuid() }), execute: async ({ taskId }) => getTaskContext(actorId, projectId, taskId),
    }),
    list_proposals: tool({
      description: "查询可见的 AI 草案及确认状态，区分待确认、已拒绝、已执行和执行失败；本会话有 id 时仅返回本会话来源的建议。",
      inputSchema: z.object({}), execute: async () => {
        const proposals = await listApprovalRequests(actorId, projectId);
        return proposals.filter(proposal => !conversationId || proposal.sourceConversationId === conversationId).slice(0, 30)
          .map(proposal => ({ id: proposal.id, tool: proposal.tool, title: proposal.title, status: proposal.status, payload: proposal.payload, error: proposal.error }));
      },
    }),
    list_tasks: tool({
      description:
        "按状态、负责人、截止日筛选该项目任务，返回含 taskId。改任务前必先用它取回 id。",
      inputSchema: z.object({
        status: z.enum(TASK_STATUSES).optional(),
        assigneeId: z.string().optional().describe("负责人用户 id"),
        dueBefore: z.string().optional().describe("截止日不晚于此日期（YYYY-MM-DD）"),
        stageId: z.uuid().optional().describe("执行阶段 id，来自 query_stage_progress"),
        query: z.string().trim().max(160).optional().describe("任务标题或说明关键词"),
      }),
      execute: async (filters) => listTasksFiltered(actorId, projectId, filters),
    }),
    list_projects: tool({
      description:
        "列出我参与的全部项目（跨团队）及其任务统计。用户问「我有哪些项目」或需跨项目比较时用。无需参数。",
      inputSchema: z.object({}),
      execute: async () => listMyProjectsBrief(actorId),
    }),
    list_milestones: tool({
      description: "列出该项目全部里程碑，返回含 milestoneId。快照未列出里程碑时用它现查。无需参数。",
      inputSchema: z.object({}),
      execute: async () => listMilestonesBrief(actorId, projectId),
    }),
    create_project: tool({
      description: "拟一个新项目草案（在当前项目所属团队下）。仅产草案，需人工确认后落库。",
      inputSchema: z.object({
        name: z.string(),
        description: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      execute: async (input) => draftEnvelope("create_project", input),
    }),
    decompose_tasks: tool({
      description: "把目标/需求拆成任务清单草案。仅产草案，需人工确认后落库。",
      inputSchema: z.object({
        tasks: z.array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            assigneeId: z.string().optional(),
            dueDate: z.string().optional(),
            milestoneId: z.string().optional(),
            priority: z.enum(["low", "medium", "high"]).optional(),
            handoffBrief: z.string().optional(),
            doneCriteria: z.array(z.string()).max(MAX_DONE_CRITERIA).optional(),
            requiredEvidence: z.array(z.enum(EVIDENCE_TYPES)).optional(),
            responseDueAt: z.string().optional().describe("响应期限 ISO 时间"),
            contextPackId: z.string().optional(),
          }),
        ),
      }),
      execute: async (input) => draftEnvelope("decompose_tasks", input),
    }),
    update_tasks: tool({
      description: "拟批量任务变更草案（状态/负责人/截止日/里程碑/优先级/标题/交接契约）。仅产草案，需人工确认。",
      inputSchema: z.object({
        updates: z.array(
          z.object({
            taskId: z.string(),
            patch: z.object({
              title: z.string().optional(),
              status: z.enum(TASK_STATUSES).optional(),
              assigneeId: z.string().optional(),
              dueDate: z.string().optional(),
              milestoneId: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
              handoffBrief: z.string().optional(),
              doneCriteria: z.array(z.string()).max(MAX_DONE_CRITERIA).optional(),
              requiredEvidence: z.array(z.enum(EVIDENCE_TYPES)).optional(),
              responseDueAt: z.string().optional().describe("响应期限 ISO 时间"),
              contextPackId: z.string().optional(),
            }),
          }),
        ),
      }),
      // 为每个 update 填入当前 updatedAt（乐观锁读时版本），供 commit 比对
      execute: async (input) => {
        const rows = await listProjectTasks(actorId, projectId);
        const versionOf = new Map(rows.map((r) => [r.id, r.updatedAt]));
        const updates = input.updates.map((u) => ({
          taskId: u.taskId,
          updatedAt: versionOf.get(u.taskId)?.toISOString() ?? "",
          patch: u.patch,
        }));
        return draftEnvelope("update_tasks", { updates });
      },
    }),
    plan_sprint: tool({
      description: "把选定任务排入某里程碑并批量设截止日。仅产草案，需人工确认。",
      inputSchema: z.object({
        milestoneId: z.string(),
        taskIds: z.array(z.string()),
        dueDate: z.string(),
      }),
      execute: async (input) => draftEnvelope("plan_sprint", input),
    }),
    create_milestone: tool({
      description: "在当前项目下拟一个里程碑草案（阶段节点，如中期答辩）。仅产草案，需人工确认后落库。",
      inputSchema: z.object({
        title: z.string(),
        targetDate: z.string().optional().describe("目标日期 YYYY-MM-DD"),
      }),
      execute: async (input) => draftEnvelope("create_milestone", input),
    }),
    create_decision: tool({
      description:
        "把方案比较结果整理成待确认的决策草案。AI 只能提出 proposed，必须由人选择方案并填写理由后才能接受。",
      inputSchema: z.object({
        title: z.string().min(1),
        question: z.string().min(1),
        taskId: z.string().uuid().nullable().optional(),
        milestoneId: z.string().uuid().nullable().optional(),
        options: z
          .array(
            z.object({
              label: z.string().min(1),
              description: z.string().optional(),
              benefits: z.array(z.string()).optional(),
              risks: z.array(z.string()).optional(),
              evidenceRefs: z
                .array(z.object({ type: z.enum(["message", "entry", "task", "context_item"]), id: z.uuid() }))
                .optional(),
            }),
          )
          .min(1)
          .max(8),
        sourceConversationId: z.string().uuid().nullable().optional(),
        sourceMessageId: z.string().uuid().nullable().optional(),
      }),
      execute: async (input) => draftEnvelope("create_decision", input),
    }),
  };
}

export const WRITE_TOOL_NAMES = [
  "create_project",
  "decompose_tasks",
  "update_tasks",
  "plan_sprint",
  "create_milestone",
  "create_decision",
] as const;

export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

// 草案信封：写工具 execute 的统一返回形态，供 orchestrator 识别提取
export type DraftEnvelope = { __draft: true; tool: WriteToolName; draft: unknown };

function draftEnvelope(tool: WriteToolName, draft: unknown): DraftEnvelope {
  return { __draft: true, tool, draft };
}
