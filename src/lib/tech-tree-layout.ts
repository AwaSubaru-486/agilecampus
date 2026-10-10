import { taskLevels, type DraftTask, type StagePlan } from "./draft-planning";

export type TreeSection = { title: string; keys: string[] };

/** Hide redundant shortcuts while preserving every reachable prerequisite. */
export function directPlanningLinks(plan: StagePlan): StagePlan {
  const byKey = new Map(plan.links.map(link => [link.key, link.afterKeys]));
  function reaches(from: string, target: string, seen = new Set<string>()): boolean {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (byKey.get(from) ?? []).some(before => reaches(before, target, seen));
  }
  return { ...plan, links: plan.links.map(link => ({ ...link, afterKeys: link.afterKeys.filter(before => !link.afterKeys.some(other => other !== before && reaches(other, before))) })) };
}

/** Stage boundaries reserve contiguous columns; dependencies determine columns within them. */
export function layoutTechTree(tasks: DraftTask[], plan: StagePlan, sections: TreeSection[]) {
  const levels = taskLevels(plan);
  const positions = new Map<string, { x: number; y: number }>();
  const groups = new Set(tasks.flatMap(task => task.parentKey ? [task.parentKey] : []));
  const bands: { title: string; left: number; right: number }[] = [];
  let startColumn = 0;
  let maxRows = 1;
  for (const section of sections) {
    const rows = new Map<number, number>();
    const columns = new Map<string, number>();
    const links = new Map(plan.links.map(link => [link.key, link]));
    const keys = new Set(section.keys);
    const hasGroups = section.keys.some(key => groups.has(key));
    function column(key: string): number {
      if (columns.has(key)) return columns.get(key)!;
      const localParents = (links.get(key)?.afterKeys ?? []).filter(before => keys.has(before));
      const result = groups.has(key) ? 0 : Math.max(hasGroups ? 1 : 0, ...localParents.map(before => column(before) + 1));
      columns.set(key, result); return result;
    }
    const ordered = section.keys.filter(key => tasks.some(task => task.key === key)).sort((a, b) => (levels.get(a) ?? 0) - (levels.get(b) ?? 0));
    for (const key of ordered) {
      const col = column(key);
      const predecessors = links.get(key)?.afterKeys ?? [];
      const parentRows = predecessors.flatMap(before => positions.has(before) ? [(positions.get(before)!.y - 88) / 172] : []);
      let row = parentRows.length ? Math.round(parentRows.reduce((a, b) => a + b, 0) / parentRows.length) : 0;
      while (rows.has(col * 10000 + row)) row++;
      rows.set(col * 10000 + row, 1);
      maxRows = Math.max(maxRows, row + 1);
      positions.set(key, { x: 46 + (startColumn + col) * 330, y: 88 + row * 172 });
    }
    // A stage with just a start column still occupies one column, rather than an empty extra one.
    const count = columns.size ? Math.max(...columns.values()) + 1 : 1;
    bands.push({ title: section.title, left: startColumn * 330, right: (startColumn + count) * 330 });
    startColumn += count;
  }
  return { positions, bands, width: Math.max(670, startColumn * 330 + 46), height: Math.max(340, 120 + maxRows * 172) };
}
