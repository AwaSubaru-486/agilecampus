import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { AppError } from "./errors";
import { createEvidenceItem, EVIDENCE_LABEL, missingRequiredEvidence } from "./evidence";
import type { EvidenceType } from "./handoff";
import { submitTask } from "./task";
import { submitTaskDelivery } from "./task-tree";
import { notifyTaskSubmitted } from "./notify";

export async function submitTaskWithDelivery(actorId: string, taskId: string, input: {
  branchName: string; headSha?: string; pullRequestUrl?: string; testSummary?: string;
  completionNote: string; handoffVersion: number; evidence: Partial<Record<EvidenceType, string>>;
}) {
  const [target] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId));
  if (!target) throw new AppError("任务不存在");
  const result = await db.transaction(async tx => {
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, target.projectId)).for("update");
    await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).for("update");
    const missing = await missingRequiredEvidence(actorId, taskId, { tx });
    for (const type of missing) {
      const value = input.evidence[type]?.trim();
      if (!value) throw new AppError(`请补充必需交付材料：${EVIDENCE_LABEL[type]}`);
      await createEvidenceItem(actorId, taskId, { type, label: EVIDENCE_LABEL[type], value }, { tx });
    }
    await submitTaskDelivery(actorId, taskId, input, { tx });
    return submitTask(actorId, taskId, { completionNote: input.completionNote, handoffVersion: input.handoffVersion }, { tx });
  });
  void notifyTaskSubmitted(result);
  return result;
}
