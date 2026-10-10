import { emptyDraftPlan, validateDraftPlan, type DraftPlan, type PlanningLink } from "./draft-planning";
import type { TaskTreePayload } from "./task-tree";

export function publishedTreePayload(tree: { stages: { id: string; title: string }[]; tasks: { id: string; stageId: string | null; parentTaskId: string | null; title: string; description: string | null; priority: "low" | "medium" | "high"; doneCriteria: unknown }[] }, summary: string): TaskTreePayload {
  const stages = [...tree.stages, ...(tree.tasks.some(task => !task.stageId) ? [{ id: "unassigned-stage", title: "未归入阶段的任务" }] : [])];
  return { summary, stages: stages.flatMap(stage => {
    const rows = tree.tasks.filter(task => stage.id === "unassigned-stage" ? !task.stageId : task.stageId === stage.id);
    const keys = new Set(rows.map(task => task.id));
    return rows.length ? [{ title: stage.title, tasks: rows.map(task => ({ key: task.id, parentKey: task.parentTaskId && keys.has(task.parentTaskId) ? task.parentTaskId : null, title: task.title, description: task.description ?? "", assigneeId: task.id, priority: task.priority, doneCriteria: Array.isArray(task.doneCriteria) ? task.doneCriteria.filter((value): value is string => typeof value === "string") : [] })) }] : [];
  }) };
}

export function planningSignature(payload: TaskTreePayload): string {
  return JSON.stringify({ summary: payload.summary, stages: payload.stages.map(stage => ({ title: stage.title, tasks: stage.tasks.map(({ key, parentKey, title, description, doneCriteria }) => ({ key, parentKey, title, description, doneCriteria })) })) });
}

export function mapWholeTimelinePlan(payload: TaskTreePayload, original: TaskTreePayload, plan: DraftPlan): DraftPlan | null {
  if (payload.stages.length !== original.stages.length) return null;
  const mapping = new Map<string, string>();
  for (let index = 0; index < original.stages.length; index++) {
    const actual = payload.stages[index].tasks;
    if (actual.length !== original.stages[index].tasks.length) return null;
    for (const task of original.stages[index].tasks) {
      const matches = actual.filter(item => item.title === task.title);
      if (matches.length !== 1) return null;
      mapping.set(task.key, matches[0].key);
    }
  }
  if (new Set(mapping.values()).size !== original.stages.reduce((sum, stage) => sum + stage.tasks.length, 0)) return null;
  const mapped = { ...plan, stages: plan.stages.map(stage => ({ ...stage, links: stage.links.map(link => ({ ...link, key: mapping.get(link.key)!, afterKeys: link.afterKeys.map(key => mapping.get(key)!) })) })) };
  try { validateDraftPlan(payload, mapped); return mapped; } catch { return null; }
}

export function mapTimelinePlan(payload: TaskTreePayload, original: TaskTreePayload["stages"][number], links: PlanningLink[]): DraftPlan | null {
  const tasks = payload.stages[0].tasks;
  // No positional guesses: renamed, removed or duplicate titles invalidate this local overlay.
  if (tasks.length !== original.tasks.length) return null;
  const mapping = new Map<string, string>();
  for (const task of original.tasks) {
    const matches = tasks.filter(item => item.title === task.title);
    if (matches.length !== 1) return null;
    mapping.set(task.key, matches[0].key);
  }
  if (new Set(mapping.values()).size !== tasks.length) return null;
  const plan = emptyDraftPlan(payload);
  plan.stages[0].links = links.map(link => ({ ...link, key: mapping.get(link.key)!, afterKeys: link.afterKeys.map(key => mapping.get(key)!) }));
  try { validateDraftPlan(payload, plan); return plan; } catch { return null; }
}
