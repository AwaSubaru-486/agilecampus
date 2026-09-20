import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { evidenceItems, tasks, type EvidenceType } from "@/db/schema";
import { AppError, ForbiddenError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";
import { recordEvent } from "@/lib/activity";
import { EVIDENCE_TYPES } from "@/lib/handoff";

export { EVIDENCE_TYPES };
export type { EvidenceType };

export const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  link: "链接",
  file: "文件",
  text: "文字说明",
  test: "测试结果",
  demo: "演示",
  entry: "项目档案",
  message: "协作消息",
  run: "Agent 运行",
};

export type EvidenceInput = {
  type: EvidenceType;
  label: string;
  value: string;
  sourceId?: string | null;
};

async function taskContext(actorId: string, taskId: string) {
  const [task] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      assigneeId: tasks.assigneeId,
      requiredEvidence: tasks.requiredEvidence,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();
  return { task, access };
}

export async function createEvidenceItem(actorId: string, taskId: string, input: EvidenceInput) {
  const { task, access } = await taskContext(actorId, taskId);
  if (task.assigneeId !== actorId && access.role !== "admin" && access.role !== "teacher") {
    throw new ForbiddenError("只有负责人、组长或教师可以补充交付证据");
  }

  const label = input.label.trim();
  const value = input.value.trim();
  if (!label) throw new AppError("证据需要一个名称");
  if (!value) throw new AppError("证据内容不能为空");
  if (label.length > 160) throw new AppError("证据名称最多 160 个字");
  if (value.length > 8_000) throw new AppError("证据内容最多 8000 个字");
  if (input.type === "link" && !/^https?:\/\//i.test(value)) {
    throw new AppError("链接证据必须以 http:// 或 https:// 开头");
  }

  const [created] = await db
    .insert(evidenceItems)
    .values({
      projectId: task.projectId,
      taskId,
      submittedById: actorId,
      type: input.type,
      label,
      value,
      sourceId: input.sourceId ?? null,
    })
    .returning();

  await recordEvent(db, {
    projectId: task.projectId,
    actorId,
    taskId,
    type: "evidence_added",
    summary: `补充证据：${label}`,
    payload: { evidenceId: created.id, type: input.type, label },
  });
  return created;
}

export async function listTaskEvidence(actorId: string, taskId: string) {
  const { task } = await taskContext(actorId, taskId);
  return db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.projectId, task.projectId), eq(evidenceItems.taskId, taskId)))
    .orderBy(desc(evidenceItems.createdAt));
}

export async function missingRequiredEvidence(actorId: string, taskId: string): Promise<EvidenceType[]> {
  const { task } = await taskContext(actorId, taskId);
  const required = Array.isArray(task.requiredEvidence)
    ? task.requiredEvidence.filter((item): item is EvidenceType =>
        typeof item === "string" && EVIDENCE_TYPES.includes(item as (typeof EVIDENCE_TYPES)[number]),
      )
    : [];
  if (required.length === 0) return [];

  const existing = await db
    .select({ type: evidenceItems.type })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.projectId, task.projectId), eq(evidenceItems.taskId, taskId)));
  const present = new Set(existing.map((item) => item.type));
  return [...new Set(required)].filter((type) => !present.has(type));
}
