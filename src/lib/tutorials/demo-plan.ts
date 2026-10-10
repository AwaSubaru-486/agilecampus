import { emptyDraftPlan, validateDraftPlan } from "../draft-planning";
import type { TaskTreePayload } from "../task-tree";

/** Explicit teaching fixture, never presented as a model-generated analysis. */
export function tutorialDemoPlan(payload: TaskTreePayload) {
  const keys = new Set(payload.stages.flatMap(stage => stage.tasks).map(task => task.key));
  if (!keys.has("signup") || !keys.has("receipt")) return null;
  const plan = emptyDraftPlan(payload);
  const parents: Record<string, string[]> = { verify: ["signup", "checks"], receipt: [keys.has("verify") ? "verify" : "signup"] };
  plan.stages.forEach(stage => stage.links.forEach(link => {
    link.afterKeys = (parents[link.key] ?? []).filter(key => keys.has(key));
    link.reason = link.key === "verify" ? "先拿到报名表单与验证用例，再汇合检查结果。" : link.key === "receipt" ? "报名流程验证完成后，再增加成功回执。" : "教学起点：表单实现与验证用例准备可以并行。";
  }));
  plan.reviewNote = "教学预设关系，用于练习并行、汇合与跨阶段连接；不是 AI 分析结果。真实 AI 分析请使用重新安排与复核按钮。";
  validateDraftPlan(payload, plan);
  return plan;
}
