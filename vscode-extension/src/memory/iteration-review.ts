import type { MemoryDocumentV1 } from "../../../shared/session-memory/types";
import { sha256, stableStringify } from "./input-snapshot";
import type { ExtractionSnapshotV1, MemoryDraftV1 } from "./types";

/** A review aid, not a completion decision. Parent identity is verified before comparison. */
export function renderIterationReview(draft: MemoryDraftV1, snapshot: ExtractionSnapshotV1, parent?: MemoryDocumentV1): string {
  if (draft.snapshotId !== snapshot.snapshotId || stableStringify(draft.scope) !== stableStringify(snapshot.scope)) throw new Error("迭代总结与当前会话快照不匹配");
  const reference = draft.parentReference;
  if (parent && (!reference || parent.id !== draft.parentMemoryId || parent.id !== reference.memoryId ||
      parent.revision !== reference.revision || sha256(stableStringify(parent)) !== reference.memoryDigest ||
      parent.projectId !== draft.scope.projectId || parent.taskId !== draft.scope.taskId)) throw new Error("迭代总结的父记忆版本不匹配");
  const active = (category: keyof MemoryDraftV1["items"]) => draft.items[category].filter((item) => item.disposition === "active");
  const lines = ["本轮迭代结果 · 待人工核对", `当前草稿：${draft.memoryId} / r${draft.revision}`,
    `代码：${snapshot.headSha}${snapshot.dirtyExcluded ? "（未提交改动未包含在基线中）" : ""}`,
    `来源：事件 ${snapshot.fromSequence}–${snapshot.toSequence}；采集缺口 ${snapshot.gapEventIds.length}；预算遗漏/截断 ${draft.inputCoverage.omissions.length}`];
  if (parent) lines.push(`继承版本：${parent.id} / r${parent.revision}`, `继承代码：${parent.code.headSha}`);
  else lines.push(reference ? "继承版本在本机不可用，未推测前后变化。" : "没有精确父版本，以下仅列当前草稿。请勿当作增量进展。");
  for (const [category, label] of [["completed", "完成记录"], ["rejectedApproaches", "失败方法及条件"], ["decisions", "决策记录"]] as const) {
    const before = new Set(parent?.[category].filter((item) => item.disposition === "active").map((item) => item.text) ?? []);
    lines.push("", `${parent ? "新增" : "当前"}${label}：`);
    const items = active(category).filter((item) => !parent || !before.has(item.text));
    lines.push(...(items.length ? items.map((item) => `${JSON.stringify(item.text)} [${item.support}；出处 ${item.evidenceRefs.join(", ") || "未关联"}]`) : ["无新增记录"]));
  }
  if (parent) {
    const after = new Set(active("blockers").map((item) => item.text));
    const removed = parent.blockers.filter((item) => item.disposition === "active" && !after.has(item.text));
    lines.push("", "不再出现在当前草稿中的阻塞（需确认是否解决）：", ...removed.map((item) => JSON.stringify(item.text)));
    if (!removed.length) lines.push("无");
    const failures = new Set(active("rejectedApproaches").map((item) => item.text));
    const omittedFailures = parent.rejectedApproaches.filter((item) => item.disposition === "active" && !failures.has(item.text));
    if (omittedFailures.length) lines.push("", "未延续的失败记录（核对是否遗漏或条件已变化）：", ...omittedFailures.map((item) => JSON.stringify(item.text)));
  }
  for (const [category, label] of [["blockers", "当前阻塞"], ["remaining", "待完成"], ["nextActions", "下一步"]] as const) {
    lines.push("", `${label}：`, ...active(category).map((item) => JSON.stringify(item.text)));
    if (!active(category).length) lines.push("未记录");
  }
  lines.push("", "本次快照中的测试证据（未运行新测试）：");
  const tests = draft.tests.filter((test) => test.disposition !== "superseded");
  for (const test of tests) {
    const events = snapshot.events.filter((event) => test.evidenceRefs.includes(event.id));
    const results = test.support === "captured" && test.exitCode !== null ? events.filter((result) =>
      result.kind === "tool_result" && result.exitCode === test.exitCode && !!result.toolCallId && events.some((call) =>
        call.kind === "tool_call" && call.command === test.command && call.toolCallId === result.toolCallId && result.sequence > call.sequence)) : [];
    const captured = results.length > 0;
    const current = captured && results.some((event) => !event.sourceRef.startsWith("agilecampus:inherited-memory:") &&
      (!parent || parent.sessionKey !== draft.scope.sessionKey || event.sequence > parent.sourceCoverage.toSequence));
    const evidenceLabel = !captured ? "未核实工具执行，仅作待核对记录" : !parent ? "当前会话工具执行记录（无父版本，未确认增量）" : current ? "本轮工具执行记录" : "历史工具执行记录";
    lines.push(`${JSON.stringify(test.command)}：${test.disposition === "uncertain" ? "待核对；" : ""}${evidenceLabel}；退出码 ${test.exitCode ?? "未知"}；出处 ${test.evidenceRefs.join(", ")}`);
  }
  if (!tests.length) lines.push("未记录；不能推断测试已通过。");
  const uncertain = Object.entries(draft.items).flatMap(([category, items]) => items.filter((item) => item.disposition === "uncertain").map((item) => `${category}：${JSON.stringify(item.text)}；出处 ${item.evidenceRefs.join(", ") || "未关联"}`));
  if (uncertain.length) lines.push("", "存在不确定的记忆条目：", ...uncertain);
  lines.push("", "以上按记录文字比较；新增完成项或移除阻塞均不代表任务已验收。审核后可修改草稿，再接受并保存新断点。");
  return lines.join("\n");
}
