import { emptyDraftPlan, validateDraftPlan, type DraftPlan, type PlanningLink } from "./draft-planning";
import type { TaskTreePayload } from "./task-tree";

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
