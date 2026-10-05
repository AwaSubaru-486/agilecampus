/**
 * Conversation tree presentation model.
 *
 * Adapted from LodyAI/Lody's session-opened-by-tree model
 * (Apache-2.0, https://github.com/LodyAI/Lody). AgileCampus keeps the
 * project-specific relation name `parentConversationId`, but preserves the
 * useful safety rules: missing parents become roots, cycles never hide rows,
 * every item is rendered once, and incoming order remains stable for ties.
 */

export type ConversationTreeNode<T> = {
  item: T;
  id: string;
  parentId: string | null;
  depth: number;
  childCount: number;
  isLastChild: boolean;
  expanded: boolean;
};

export type ConversationTreeOptions<T> = {
  getId: (item: T) => string;
  getParentId: (item: T) => string | null | undefined;
  isCollapsed?: (parentId: string) => boolean;
  maxRoots?: number;
};

function normalizeId(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function resolveParents<T>(items: readonly T[], options: ConversationTreeOptions<T>) {
  const indexById = new Map<string, number>();
  items.forEach((item, index) => {
    const id = options.getId(item);
    if (!indexById.has(id)) indexById.set(id, index);
  });

  const parentById = new Map<string, string | null>();
  for (const item of items) {
    const id = options.getId(item);
    let parentId = normalizeId(options.getParentId(item));
    const visited = new Set([id]);
    let resolved: string | null = null;

    while (parentId) {
      if (visited.has(parentId)) {
        resolved = null;
        break;
      }
      if (!indexById.has(parentId)) {
        resolved = null;
        break;
      }
      resolved = parentId;
      visited.add(parentId);
      const parentIndex = indexById.get(parentId);
      const parent = parentIndex === undefined ? undefined : items[parentIndex];
      parentId = parent ? normalizeId(options.getParentId(parent)) : null;
    }

    const declared = normalizeId(options.getParentId(item));
    parentById.set(id, resolved === null ? null : declared);
  }
  return parentById;
}

export function buildConversationTree<T>(
  items: readonly T[],
  options: ConversationTreeOptions<T>,
): ConversationTreeNode<T>[] {
  if (items.length === 0) return [];

  const parentById = resolveParents(items, options);
  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];

  for (const item of items) {
    const id = options.getId(item);
    const parentId = parentById.get(id) ?? null;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    const children = childrenByParent.get(parentId);
    if (children) children.push(item);
    else childrenByParent.set(parentId, [item]);
  }

  const visibleRoots =
    typeof options.maxRoots === "number" && options.maxRoots >= 0
      ? roots.slice(0, options.maxRoots)
      : roots;
  const nodes: ConversationTreeNode<T>[] = [];

  function visit(item: T, depth: number, parentId: string | null, ancestry: Set<string>) {
    const id = options.getId(item);
    const children = childrenByParent.get(id) ?? [];
    const expanded = children.length === 0 || !options.isCollapsed?.(id);
    nodes.push({ item, id, parentId, depth, childCount: children.length, isLastChild: false, expanded });
    if (!expanded) return;

    children.forEach((child, index) => {
      if (ancestry.has(options.getId(child))) return;
      const childNodeIndex = nodes.length;
      visit(child, depth + 1, id, new Set([...ancestry, id]));
      const childNode = nodes[childNodeIndex];
      if (childNode) childNode.isLastChild = index === children.length - 1;
    });
  }

  for (const root of visibleRoots) visit(root, 0, null, new Set([options.getId(root)]));
  return nodes;
}

export function countConversationRoots<T>(
  items: readonly T[],
  options: Pick<ConversationTreeOptions<T>, "getId" | "getParentId">,
) {
  return buildConversationTree(items, options).filter((node) => node.depth === 0).length;
}
