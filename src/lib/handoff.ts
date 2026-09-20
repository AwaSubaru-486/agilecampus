import { AppError } from "./errors";

export const EVIDENCE_TYPES = ["link", "file", "text", "test", "demo"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const MAX_DONE_CRITERIA = 8;
export const MAX_HANDOFF_BRIEF_LENGTH = 2_000;

export type HandoffFields = {
  handoffBrief?: string | null;
  doneCriteria?: string[] | null;
  requiredEvidence?: EvidenceType[] | null;
  responseDueAt?: Date | null;
  contextPackId?: string | null;
};

export function normalizeDoneCriteria(criteria: string[] | null | undefined) {
  if (criteria == null) return null;
  const normalized = criteria.map((item) => item.trim()).filter(Boolean);
  if (normalized.length > MAX_DONE_CRITERIA) {
    throw new AppError(`完成条件最多 ${MAX_DONE_CRITERIA} 条`);
  }
  if (normalized.some((item) => item.length > 240)) {
    throw new AppError("每条完成条件最多 240 个字");
  }
  return normalized;
}

export function normalizeRequiredEvidence(evidence: EvidenceType[] | null | undefined) {
  if (evidence == null) return null;
  const unique = [...new Set(evidence)];
  if (unique.some((item) => !EVIDENCE_TYPES.includes(item))) {
    throw new AppError("证据类型无效");
  }
  return unique;
}

export function normalizeHandoffFields(input: HandoffFields): HandoffFields {
  const handoffBrief = input.handoffBrief?.trim() || null;
  if (handoffBrief && handoffBrief.length > MAX_HANDOFF_BRIEF_LENGTH) {
    throw new AppError(`交接说明最多 ${MAX_HANDOFF_BRIEF_LENGTH} 个字`);
  }
  return {
    handoffBrief,
    doneCriteria: normalizeDoneCriteria(input.doneCriteria),
    requiredEvidence: normalizeRequiredEvidence(input.requiredEvidence),
    responseDueAt: input.responseDueAt ?? null,
    contextPackId: input.contextPackId ?? null,
  };
}

export function handoffToPrompt(fields: {
  handoffBrief: string | null;
  doneCriteria: unknown;
  requiredEvidence: unknown;
  responseDueAt: Date | null;
}) {
  const criteria = Array.isArray(fields.doneCriteria)
    ? fields.doneCriteria.filter((item): item is string => typeof item === "string")
    : [];
  const evidence = Array.isArray(fields.requiredEvidence)
    ? fields.requiredEvidence.filter((item): item is string => typeof item === "string")
    : [];
  return [
    fields.handoffBrief ? `交接目标：${fields.handoffBrief}` : "",
    criteria.length ? `完成条件：${criteria.map((item) => `- ${item}`).join(" ")}` : "",
    evidence.length ? `必须带回的证据：${evidence.join("、")}` : "",
    fields.responseDueAt ? `响应期限：${fields.responseDueAt.toISOString().slice(0, 10)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
