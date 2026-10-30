import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContinuationFixture } from "./fixtures/session-memory/continuation-fixture";
import { inspectReceptionCode, renderReceptionCodeCheck } from "../src/memory/reception-check";
import { renderIterationReview } from "../src/memory/iteration-review";
import { sha256, stableStringify } from "../src/memory/input-snapshot";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agile-iteration-")); roots.push(root);
  const f = await createContinuationFixture(root);
  const [draft] = await f.drafts.listDrafts(f.scope);
  // The fixture builds its snapshot in memory rather than persisting it.
  const { createInputSnapshot } = await import("../src/memory/input-snapshot");
  const fresh = await createInputSnapshot(f.scope, { store: f.events, workspacePath: f.workspacePath, localRepositoryId: f.localId });
  const current = { ...structuredClone(draft), snapshotId: fresh.snapshotId };
  return { ...f, draft: current, snapshot: fresh };
}

describe("code reception check", () => {
  it("reads real changed paths including rename sides without modifying HEAD or working files", async () => {
    const f = await fixture();
    expect((await inspectReceptionCode(f.workspacePath, f.repository.headSha, f.repository.headSha)).status).toBe("same");
    f.git("mv", "search.ts", "search-v2.ts");
    await writeFile(path.join(f.workspacePath, "new\nfile.ts"), "// test\n");
    f.git("add", "."); f.git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "rename");
    const head = f.git("rev-parse", "HEAD");
    const result = await inspectReceptionCode(f.workspacePath, f.repository.headSha, head);
    expect(result.paths).toEqual(expect.arrayContaining(["search.ts", "search-v2.ts", "new\nfile.ts"]));
    expect(renderReceptionCodeCheck(result)).toContain('"new\\nfile.ts"');
    expect(f.git("rev-parse", "HEAD")).toBe(head);
    expect(f.git("status", "--porcelain")).toBe("");
  });
  it("reports unavailable commits without guessing that no files changed", async () => {
    const f = await fixture();
    const result = await inspectReceptionCode(f.workspacePath, "f".repeat(40), f.repository.headSha);
    expect(result.status).toBe("unavailable");
    expect(renderReceptionCodeCheck(result)).toContain("未核对");
    expect((await inspectReceptionCode(f.workspacePath, "--output=/tmp/test", null)).status).toBe("unavailable");
  });
});

describe("iteration review", () => {
  it("pins the parent digest and labels removed blockers as requiring confirmation", async () => {
    const f = await fixture();
    const parent = structuredClone(f.handoff.memory);
    parent.blockers = [{ id: randomUUID(), text: "索引未验证", support: "reported", origin: "human", disposition: "active", evidenceRefs: [] }];
    f.draft.parentMemoryId = parent.id;
    f.draft.parentReference = { memoryId: parent.id, revision: parent.revision, memoryDigest: sha256(stableStringify(parent)) };
    f.draft.items.completed.push({ id: randomUUID(), text: "新增索引", support: "reported", origin: "human", candidateKey: null, disposition: "active", evidenceRefs: [] });
    const report = renderIterationReview(f.draft, f.snapshot, parent);
    expect(report).toContain("新增完成记录");
    expect(report).toContain("reported；出处 未关联");
    expect(report).toContain("需确认是否解决");
    expect(report).toContain("索引未验证");
    expect(report).toContain("历史工具执行记录");
    f.draft.items.rejectedApproaches[0].disposition = "uncertain";
    const uncertain = renderIterationReview(f.draft, f.snapshot, parent);
    expect(uncertain).toContain("未延续的失败记录");
    expect(uncertain).toContain("存在不确定的记忆条目");
    parent.revision += 1;
    expect(() => renderIterationReview(f.draft, f.snapshot, parent)).toThrow("父记忆版本不匹配");
  });
  it("requires matching structured tool evidence and preserves unknown and nonzero exits", async () => {
    const f = await fixture();
    let report = renderIterationReview(f.draft, f.snapshot);
    expect(report).toContain("当前会话工具执行记录（无父版本，未确认增量）；退出码 0");
    expect(report).toContain("没有精确父版本");
    f.draft.tests[0].exitCode = 1;
    report = renderIterationReview(f.draft, f.snapshot);
    expect(report).toContain("未核实工具执行，仅作待核对记录；退出码 1");
    f.draft.tests[0].exitCode = null;
    expect(renderIterationReview(f.draft, f.snapshot)).toContain("退出码 未知");
    f.draft.tests[0].exitCode = 0;
    f.draft.tests[0].evidenceRefs = [f.snapshot.events[0].id];
    expect(renderIterationReview(f.draft, f.snapshot)).not.toContain("本轮工具执行记录；");
  });
  it("does not invent a parent, expose superseded entries, or cross scopes", async () => {
    const f = await fixture();
    f.draft.parentMemoryId = f.handoff.memory.id;
    f.draft.parentReference = { memoryId: f.handoff.memory.id, revision: 3, memoryDigest: "f".repeat(64) };
    f.draft.items.rejectedApproaches[0].disposition = "superseded";
    const report = renderIterationReview(f.draft, f.snapshot);
    expect(report).toContain("继承版本在本机不可用");
    expect(report).not.toContain("cache approach");
    expect(() => renderIterationReview(f.draft, { ...f.snapshot, scope: { ...f.scope, actorScope: "f".repeat(64) } })).toThrow("快照不匹配");
  });
});
