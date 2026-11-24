import { taskLevels, type DraftTask, type StagePlan } from "./draft-planning";

export type TreeSection = { title: string; keys: string[] };
type Point = { x: number; y: number };

const nodeWidth = 252;
const nodeHeight = 116;
const firstRow = 88;
const rowSpacing = 172;

export function techTreeLinkPath(from: Point, to: Point, obstacles: readonly Point[] = [], lane = 0): string {
  const startX = from.x + nodeWidth;
  const startY = from.y + nodeHeight / 2;
  const endY = to.y + nodeHeight / 2;
  const mid = (startX + to.x) / 2;
  const firstY = Math.min(startY, endY);
  const lastY = Math.max(startY, endY);
  const overlaps = (left: number, right: number, node: Point) => left < node.x + nodeWidth && right > node.x;
  const crossesNode = obstacles.some(node =>
    (startY > node.y && startY < node.y + nodeHeight && overlaps(startX, mid, node)) ||
    (endY > node.y && endY < node.y + nodeHeight && overlaps(mid, to.x, node)) ||
    (mid > node.x && mid < node.x + nodeWidth && firstY < node.y + nodeHeight && lastY > node.y)
  );
  if (!crossesNode) return `M ${startX} ${startY} H ${mid} V ${endY} H ${to.x}`;

  // Route long links through a row gap so they never disappear behind an intermediate task.
  const row = Math.round(((from.y + to.y) / 2 - firstRow) / rowSpacing);
  const across = firstRow + row * rowSpacing - 14 - (lane % 4) * 6;
  const inset = 14 + (lane % 3) * 6;
  return `M ${startX} ${startY} H ${startX + inset} V ${across} H ${to.x - inset} V ${endY} H ${to.x}`;
}

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
  const positions = new Map<string, Point>();
  const byTask = new Map(tasks.map(task => [task.key, task]));
  const bands: { title: string; left: number; right: number }[] = [];
  let startColumn = 0;
  let maxRows = 1;
  for (const section of sections) {
    const rows = new Map<number, number>();
    const columns = new Map<string, number>();
    const links = new Map(plan.links.map(link => [link.key, link]));
    const keys = new Set(section.keys);
    function column(key: string): number {
      if (columns.has(key)) return columns.get(key)!;
      const parentKey = byTask.get(key)?.parentKey;
      const localParents = [...new Set([...(links.get(key)?.afterKeys ?? []), ...(parentKey && keys.has(parentKey) ? [parentKey] : [])])].filter(before => keys.has(before));
      const result = Math.max(0, ...localParents.map(before => column(before) + 1));
      columns.set(key, result); return result;
    }
    const ordered = section.keys.filter(key => byTask.has(key)).sort((a, b) => column(a) - column(b) || (levels.get(a) ?? 0) - (levels.get(b) ?? 0));
    for (const key of ordered) {
      const col = column(key);
      const parentKey = byTask.get(key)?.parentKey;
      const predecessors = [...(links.get(key)?.afterKeys ?? []), ...(parentKey ? [parentKey] : [])];
      const parentRows = predecessors.flatMap(before => positions.has(before) ? [(positions.get(before)!.y - firstRow) / rowSpacing] : []);
      let row = parentRows.length ? Math.round(parentRows.reduce((a, b) => a + b, 0) / parentRows.length) : 0;
      while (rows.has(col * 10000 + row)) row++;
      rows.set(col * 10000 + row, 1);
      maxRows = Math.max(maxRows, row + 1);
      positions.set(key, { x: 46 + (startColumn + col) * 330, y: firstRow + row * rowSpacing });
    }
    // A stage with just a start column still occupies one column, rather than an empty extra one.
    const count = columns.size ? Math.max(...columns.values()) + 1 : 1;
    bands.push({ title: section.title, left: startColumn * 330, right: (startColumn + count) * 330 });
    startColumn += count;
  }
  return { positions, bands, width: Math.max(670, startColumn * 330 + 46), height: Math.max(340, 120 + maxRows * rowSpacing) };
}
