import type { TaskTreePayload } from "./task-tree";

export type DraftTask = TaskTreePayload["stages"][number]["tasks"][number];
export type PlanningLink = { key: string; afterKeys: string[]; reason: string };
export type StagePlan = { stageIndex: number; links: PlanningLink[] };
export type DraftPlan = { stages: StagePlan[]; reviewNote: string; source: "ai" | "manual" };

export function emptyDraftPlan(payload: TaskTreePayload): DraftPlan {
  return { source: "manual", reviewNote: "尚未进行 AI 关系分析", stages: payload.stages.map((stage, stageIndex) => ({
    stageIndex, links: stage.tasks.map(task => ({ key: task.key, afterKeys: [], reason: "待确认先后关系" })),
  })) };
}

export function validateDraftPlan(payload: TaskTreePayload, plan: DraftPlan) {
  if (plan.stages.length !== payload.stages.length) throw new Error("阶段关系不完整，请重新分析");
  const seenStages = new Set<number>();
  for (const item of plan.stages) {
    if (seenStages.has(item.stageIndex)) throw new Error("阶段关系重复");
    seenStages.add(item.stageIndex);
    const stage = payload.stages[item.stageIndex];
    if (!stage) throw new Error("关系引用了不存在的阶段");
    const keys = new Set(stage.tasks.map(task => task.key));
    const groups = new Set(stage.tasks.flatMap(task => task.parentKey ? [task.parentKey] : []));
    const byKey = new Map(item.links.map(link => [link.key, link]));
    if (byKey.size !== item.links.length || byKey.size !== keys.size) throw new Error("每个任务都需要一份关系标记");
    for (const link of item.links) {
      if (!keys.has(link.key) || link.afterKeys.some(key => !keys.has(key))) throw new Error("关系引用了不存在的任务");
      if (new Set(link.afterKeys).size !== link.afterKeys.length) throw new Error("前置任务不能重复");
      if (groups.has(link.key) && link.afterKeys.length || link.afterKeys.some(key => groups.has(key))) throw new Error("任务分组不能作为执行前置条件");
    }
    const visited = new Set<string>(), visiting = new Set<string>();
    function walk(key: string) {
      if (visiting.has(key)) throw new Error("这样连接会形成循环，请调整前置任务");
      if (visited.has(key)) return;
      visiting.add(key);
      for (const before of byKey.get(key)?.afterKeys ?? []) walk(before);
      visiting.delete(key); visited.add(key);
    }
    for (const key of keys) walk(key);
  }
}

export function taskLevels(stage: StagePlan): Map<string, number> {
  const links = new Map(stage.links.map(link => [link.key, link]));
  const levels = new Map<string, number>();
  function level(key: string): number {
    if (levels.has(key)) return levels.get(key)!;
    const parents = links.get(key)?.afterKeys ?? [];
    const result = parents.length ? Math.max(...parents.map(level)) + 1 : 0;
    levels.set(key, result); return result;
  }
  for (const key of links.keys()) level(key);
  return levels;
}

export function followingTasks(tasks: DraftTask[], stage: StagePlan, key: string): Set<string> {
  const result = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      const parents = stage.links.find(link => link.key === task.key)?.afterKeys ?? [];
      if (task.key !== key && !result.has(task.key) && (
        task.parentKey === key || task.parentKey && result.has(task.parentKey)
        || parents.some(parent => parent === key || result.has(parent))
      )) { result.add(task.key); changed = true; }
    }
  }
  return result;
}

export function removePlannedTask(payload: TaskTreePayload, plan: DraftPlan, stageIndex: number, key: string, keepFollowing: boolean) {
  const stage = payload.stages[stageIndex];
  const stagePlan = plan.stages.find(item => item.stageIndex === stageIndex)!;
  const removed = new Set([key, ...(!keepFollowing ? followingTasks(stage.tasks, stagePlan, key) : [])]);
  const task = stage.tasks.find(item => item.key === key)!;
  const upstream = stagePlan.links.find(link => link.key === key)?.afterKeys ?? [];
  const remaining = stage.tasks.filter(item => !removed.has(item.key)).map(item => ({ ...item,
    parentKey: item.parentKey === key ? task.parentKey : item.parentKey,
  }));
  if (!remaining.length && payload.stages.length === 1) throw new Error("草案至少需要保留一个任务");
  const stages = payload.stages.flatMap((item, index) => index !== stageIndex ? [item] : remaining.length ? [{ ...item, tasks: remaining }] : []);
  const plans = plan.stages.filter(item => remaining.length || item.stageIndex !== stageIndex).map(item => {
    const links = item.stageIndex !== stageIndex ? item.links : item.links.filter(link => !removed.has(link.key)).map(link => ({ ...link,
      afterKeys: [...new Set(link.afterKeys.flatMap(before => before === key && keepFollowing ? upstream : [before]))].filter(before => !removed.has(before)),
    }));
    return { stageIndex: !remaining.length && item.stageIndex > stageIndex ? item.stageIndex - 1 : item.stageIndex, links };
  });
  const nextPayload = { ...payload, stages };
  const nextPlan = { ...plan, source: "manual" as const, reviewNote: "已删除任务并调整后续连接，可让 AI 重新安排与复核。", stages: plans };
  validateDraftPlan(nextPayload, nextPlan);
  return { payload: nextPayload, plan: nextPlan };
}
