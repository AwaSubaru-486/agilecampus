import { createHash } from "node:crypto";
import type { TaskDetail } from "../types";
import type { WorkCheckpoint } from "../checkpoints/types";
import type { RepositorySnapshot } from "../git/repository-service";
import type { HandoffPlan } from "./resume-plan";

export type TaskRequirementChange = { field: string; saved: string; current: string };
export type PreflightResult =
  | { status: "blocked"; blockers: string[]; changes: TaskRequirementChange[] }
  | { status: "needs-confirmation"; blockers: []; changes: TaskRequirementChange[] }
  | { status: "ready"; blockers: []; changes: TaskRequirementChange[]; plan: HandoffPlan; warnings: string[] };

export function evaluateHandoffPreflight(input: {
  workspaceTrusted: boolean;
  projectId: string;
  checkpoint: WorkCheckpoint;
  task: TaskDetail | null;
  taskAccessible: boolean;
  repository: RepositorySnapshot | null;
  materialSummary: Array<{ kind: "context" | "transcript"; byteLength: number }>;
  checkpointCommitAvailable: boolean;
  confirmedChangedTask: boolean;
  requireHeadMatch?: boolean;
}): PreflightResult {
  const { checkpoint, task, repository } = input;
  const blockers: string[] = [];
  if (!input.workspaceTrusted) blockers.push("当前工作区不受信任。");
  if (!input.taskAccessible || !task) blockers.push("当前账号无法在线读取此任务。");
  else {
    if (checkpoint.projectId !== input.projectId || task.projectId !== input.projectId || task.id !== checkpoint.taskId) {
      blockers.push("检查点、任务和当前项目的归属不一致。");
    }
    if (task.status === "done") blockers.push("任务已验收完成，不能从此任务准备接续。");
  }
  if (!repository) blockers.push("当前工作区没有可验证的 Git 仓库和提交。");
  else {
    if (repository.key !== checkpoint.repository.key) blockers.push("当前仓库标识与检查点不匹配。");
    if (!input.checkpointCommitAvailable) blockers.push("检查点的 Git SHA 在本机仓库中不存在。");
    if (input.requireHeadMatch !== false && repository.headSha !== checkpoint.repository.headSha) blockers.push("当前 HEAD 与检查点基线不同；不会自动 checkout 或重置分支。");
    if (repository.dirty) blockers.push("当前工作区有未提交或未跟踪改动；为保护用户文件，不能准备 Agent 工作目录。");
    blockers.push(...repository.recoveryBlockers);
  }
  if (checkpoint.repository.dirty && checkpoint.repository.dirtyPolicy === "clean-only") {
    blockers.push("检查点把 dirty 状态错误标记为 clean-only，停止接续。");
  }

  const changes = task ? compareTask(checkpoint, task) : [];
  if (blockers.length) return { status: "blocked", blockers, changes };
  if (changes.length && !input.confirmedChangedTask) return { status: "needs-confirmation", blockers: [], changes };
  const warnings = ["仅支持携带已选材料创建新会话；不会恢复 Entire 的原生 session。"];
  if (checkpoint.repository.dirtyPolicy === "excluded") warnings.push("检查点创建时的未提交/未跟踪改动已排除，只能基于记录的 Git SHA 继续。");
  if (input.requireHeadMatch === false && repository && repository.headSha !== checkpoint.repository.headSha) {
    warnings.push("源工作区当前 HEAD 与检查点不同；并行尝试会从检查点 SHA 新建分支，不会从当前 HEAD 复制。");
  }
  if (checkpoint.session.provider !== "Entire CLI" || checkpoint.session.providerVersion !== "0.11.3") {
    warnings.push("检查点中的 Agent 来源或版本未通过本地 adapter 核验；只把附件当作用户提供的上下文，不尝试原生恢复。");
  }
  return {
    status: "ready",
    blockers: [],
    changes,
    warnings,
    plan: {
      checkpointId: checkpoint.id,
      projectId: checkpoint.projectId,
      taskId: checkpoint.taskId,
      baseSha: checkpoint.repository.headSha,
      branch: checkpoint.repository.branch,
      targetDirectory: repository?.rootPath ?? "",
      repositoryKey: repository?.key ?? "",
      taskFingerprint: task ? taskFingerprint(task) : "",
      materials: input.materialSummary.map(({ kind, byteLength }) => ({ kind, bytes: byteLength })),
      evidenceRequirements: task!.requiredEvidence,
      taskUpdatedAt: task!.updatedAt,
      handoffVersion: task!.handoffVersion,
      mode: "context-only",
      executesAgent: false,
    },
  };
}

function taskFingerprint(task: TaskDetail): string {
  const current = {
    id: task.id, projectId: task.projectId, title: task.title, status: task.status, priority: task.priority,
    dueDate: task.dueDate, assigneeId: task.assigneeId, assigneeName: task.assigneeName, handoffBrief: task.handoffBrief,
    doneCriteria: task.doneCriteria, requiredEvidence: task.requiredEvidence, updatedAt: task.updatedAt,
    description: task.description, completionNote: task.completionNote, responseDueAt: task.responseDueAt,
    handoffVersion: task.handoffVersion, committedHandoffVersion: task.committedHandoffVersion,
  };
  return createHash("sha256").update(JSON.stringify(current)).digest("hex");
}

function compareTask(checkpoint: WorkCheckpoint, task: TaskDetail): TaskRequirementChange[] {
  const saved = checkpoint.taskSnapshot;
  const fields: Array<{ field: string; before: unknown; after: unknown }> = [
    { field: "任务标题", before: saved.title, after: task.title },
    { field: "任务状态", before: saved.status, after: task.status },
    { field: "优先级", before: saved.priority, after: task.priority },
    { field: "截止日期", before: saved.dueDate, after: task.dueDate },
    { field: "负责人", before: `${saved.assigneeName ?? "未分配"} (${saved.assigneeId ?? "—"})`, after: `${task.assigneeName ?? "未分配"} (${task.assigneeId ?? "—"})` },
    { field: "任务描述", before: saved.description, after: task.description },
    { field: "交接要求", before: saved.handoffBrief, after: task.handoffBrief },
    { field: "完成标准", before: saved.doneCriteria, after: task.doneCriteria },
    { field: "证据要求", before: saved.requiredEvidence, after: task.requiredEvidence },
    { field: "响应期限", before: saved.responseDueAt, after: task.responseDueAt },
    { field: "提交说明", before: saved.completionNote, after: task.completionNote },
    { field: "交接契约版本", before: checkpoint.handoffVersion, after: task.handoffVersion },
    { field: "任务更新时间", before: checkpoint.taskUpdatedAt, after: task.updatedAt },
    { field: "已提交契约版本", before: saved.committedHandoffVersion, after: task.committedHandoffVersion },
  ];
  return fields.filter((entry) => JSON.stringify(entry.before) !== JSON.stringify(entry.after)).map((entry) => ({
    field: entry.field,
    saved: display(entry.before),
    current: display(entry.after),
  }));
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未填写";
  if (Array.isArray(value)) return value.length ? value.join("；") : "未填写";
  return String(value);
}
