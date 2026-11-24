import { describe, expect, it } from "vitest";
import { buildConversationTree, countConversationRoots } from "@/lib/conversation-tree";

type Row = { id: string; parentConversationId: string | null };
const options = {
  getId: (item: Row) => item.id,
  getParentId: (item: Row) => item.parentConversationId,
};

describe("conversation tree", () => {
  it("keeps roots and nested branches in incoming order", () => {
    const rows: Row[] = [
      { id: "a", parentConversationId: null },
      { id: "a2", parentConversationId: "a" },
      { id: "b", parentConversationId: null },
      { id: "a3", parentConversationId: "a" },
    ];
    expect(buildConversationTree(rows, options).map((node) => [node.id, node.depth])).toEqual([
      ["a", 0],
      ["a2", 1],
      ["a3", 1],
      ["b", 0],
    ]);
  });

  it("promotes an orphan to a root instead of hiding it", () => {
    const rows: Row[] = [{ id: "orphan", parentConversationId: "missing" }];
    expect(buildConversationTree(rows, options)[0]).toMatchObject({ id: "orphan", depth: 0, parentId: null });
  });

  it("breaks a parent cycle safely and renders each row once", () => {
    const rows: Row[] = [
      { id: "a", parentConversationId: "b" },
      { id: "b", parentConversationId: "a" },
    ];
    const tree = buildConversationTree(rows, options);
    expect(tree.map((node) => node.id)).toEqual(["a", "b"]);
    expect(tree.every((node) => node.depth === 0)).toBe(true);
  });

  it("honors collapsed roots and reports the visible root count", () => {
    const rows: Row[] = [
      { id: "a", parentConversationId: null },
      { id: "a2", parentConversationId: "a" },
      { id: "b", parentConversationId: null },
    ];
    const tree = buildConversationTree(rows, { ...options, isCollapsed: (id) => id === "a" });
    expect(tree.map((node) => node.id)).toEqual(["a", "b"]);
    expect(countConversationRoots(rows, options)).toBe(2);
  });
});
