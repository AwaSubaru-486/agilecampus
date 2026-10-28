import { describe, expect, it } from "vitest";
import { compareTaskMemories, exactMemoryParent, memoryParentCandidates, renderMemoryHelpDraft, type TaskMemoryVersionView } from "../src/lib/task-memory-view";

// Only fields used by lineage resolution; package validation is tested separately.
function version(id: string, memoryId: string, revision: number, parentMemoryId: string | null = null, taskId = "task"): TaskMemoryVersionView {
  return { id, memoryId, revision, payload: { memory: { parentMemoryId }, material: {
    scope: { projectId: "project", taskId, serverOrigin: "http://localhost:3000/" },
    goal: [], completed: [], constraints: [], remaining: [], decisions: [], rejectedApproaches: [], blockers: [], nextActions: [],
  } } } as unknown as TaskMemoryVersionView;
}
describe("memory parent navigation", () => {
  it("locates the pinned revision only when its content digest matches", () => {
    const child = version("c", "child", 1, "parent");
    child.payload.memory.parentReference = { memoryId: "parent", revision: 1, memoryDigest: "exact" };
    const old = version("a", "parent", 1), latest = version("b", "parent", 2);
    old.memoryDigest = "exact"; latest.memoryDigest = "other";
    expect(exactMemoryParent(child, [latest, old])).toBe(old);
    expect(exactMemoryParent(child, [latest])).toBeUndefined();
    old.memoryDigest = "changed";
    expect(exactMemoryParent(child, [old])).toBeUndefined();
  });
  it("keeps all parent revisions instead of inventing the revision inherited", () => {
    const first = version("a", "parent", 1), second = version("b", "parent", 2);
    expect(memoryParentCandidates(version("c", "child", 1, "parent"), [first, second])).toEqual([first, second]);
  });
  it("does not use unrelated tasks or unrelated memories", () => {
    expect(memoryParentCandidates(version("c", "child", 1, "parent"), [version("a", "parent", 1, null, "other"), version("b", "unrelated", 1)])).toEqual([]);
  });
  it("does not fabricate a parent for missing, unavailable, or self references", () => {
    const parent = version("a", "parent", 1);
    expect(memoryParentCandidates(version("b", "child", 1), [parent])).toEqual([]);
    expect(memoryParentCandidates(version("b", "child", 1, "missing"), [parent])).toEqual([]);
    expect(memoryParentCandidates(version("b", "child", 1, "child"), [version("c", "child", 2)])).toEqual([]);
  });
});
describe("literal memory changes", () => {
  it("generates an editable help snapshot with the exact record and failure conditions", () => {
    const record = version("fixed-record", "memory", 2);
    record.title = "搜索排查";
    record.payload.material.baseSha = "abc123";
    record.payload.material.rejectedApproaches = ["缓存更新后返回旧结果"];
    const draft = renderMemoryHelpDraft(record);
    expect(draft).toContain("断点记录 ID：fixed-record");
    expect(draft).toContain("缓存更新后返回旧结果");
    expect(draft).toContain("当前代码和测试结果需接手人核对");
    expect(draft).not.toContain("当前阻塞：");
  });
  it("preserves failure conditions and reports a removed blocker without claiming resolution", () => {
    const before = version("a", "parent", 1), after = version("b", "child", 1);
    before.payload.material.rejectedApproaches = ["缓存更新后返回旧结果"];
    after.payload.material.rejectedApproaches = ["缓存更新后返回旧结果"];
    before.payload.material.blockers = ["索引未验证"];
    after.payload.material.completed = ["索引测试通过", "索引测试通过"];
    expect(compareTaskMemories(after, before)).toEqual([
      { field: "completed", label: "已完成", added: ["索引测试通过"], removed: [] },
      { field: "blockers", label: "当前阻塞", added: [], removed: ["索引未验证"] },
    ]);
  });
  it("treats edits as removed and added text, not a semantic conclusion", () => {
    const before = version("a", "m", 1), after = version("b", "m", 2);
    before.payload.material.decisions = ["使用缓存"];
    after.payload.material.decisions = ["暂不使用缓存"];
    expect(compareTaskMemories(after, before)[0]).toMatchObject({ added: ["暂不使用缓存"], removed: ["使用缓存"] });
    expect(compareTaskMemories(before, before)).toEqual([]);
  });
  it("rejects cross-task comparisons", () => {
    expect(() => compareTaskMemories(version("a", "m", 1), version("b", "n", 1, null, "other"))).toThrow("同一服务");
  });
});
