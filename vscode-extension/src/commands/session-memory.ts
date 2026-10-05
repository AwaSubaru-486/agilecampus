import * as vscode from "vscode";
import type { MemoryDocumentV1 } from "../../../shared/session-memory/types";
import { AgileCampusApiClient } from "../agilecampus/api-client";
import { TokenStore } from "../auth/token-store";
import { LocalSessionStore, type LocalSessionBinding } from "../session-memory/local-store";
import { MemoryArtifactStore, createMemoryHandoffExport } from "../memory/artifact-store";
import { validateMemoryCandidate } from "../memory/candidate-validator";
import { buildAcceptedMemoryDocument, MemoryDraftStore, type MemoryDraftPatch } from "../memory/draft-store";
import { buildHandoffMaterial } from "../memory/handoff-material";
import { createExtractionPreview, prepareExtractionInput } from "../memory/input-builder";
import { createInputSnapshot, sha256, workspaceScopeHash } from "../memory/input-snapshot";
import { MemorySnapshotStore } from "../memory/snapshot-store";
import type { DraftCategory, DraftItem, DraftTest, MemoryDraftV1, MemoryScope, PreparedExtractionInputV1 } from "../memory/types";
import { GitRefLockStore } from "../attempts/git-ref-lock";
import { getLocalOnlyRepositoryId, selectBoundWorkspace, type BoundWorkspace } from "./checkpoint-support";

const CATEGORY_LABELS: Record<DraftCategory, string> = {
  goal: "目标", constraints: "约束", completed: "已完成", remaining: "待完成", decisions: "决策",
  rejectedApproaches: "失败方案", blockers: "阻塞", nextActions: "下一步",
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as DraftCategory[];

type ReviewChoice =
  | { kind: "item"; category: DraftCategory; entry: DraftItem }
  | { kind: "test"; entry: DraftTest }
  | { kind: "action"; action: "add-item" | "add-test" | "accept" | "pause" };
type ReviewQuickPickItem = vscode.QuickPickItem & { choice: ReviewChoice };

export function registerSessionMemoryCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.extractSessionMemory", () => extractSessionMemory(context)));
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.reviewSessionMemory", () => reviewSavedDraft(context)));
}

async function extractSessionMemory(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage("会话记忆需要先信任当前工作区。"); return; }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  try {
    const api = createApi(context, selected);
    const actor = await api.getCurrentActor();
    const { binding, sessionStore } = await selectLocalSession(context, selected);
    const task = await api.getTask(binding.taskId);
    if (task.id !== binding.taskId || task.projectId !== selected.binding.projectId) throw new Error("本机会话关联的任务与当前项目不匹配");
    const scope = await makeScope(selected, binding, actor.id);
    const snapshotStore = new MemorySnapshotStore(context.globalStorageUri.fsPath);
    const snapshot = await createInputSnapshot(scope, {
      store: sessionStore,
      workspacePath: selected.folder.uri.fsPath,
      localRepositoryId: await getLocalOnlyRepositoryId(context, selected.folder.uri.toString()),
    });
    await snapshotStore.saveSnapshot(snapshot);
    const input = prepareExtractionInput(snapshot);
    const drafts = new MemoryDraftStore(context.globalStorageUri.fsPath);
    const preview = createExtractionPreview(input);
    await showOutboundPreview(task.title, preview, input);
    const consent = await vscode.window.showWarningMessage(
      `确认把这 ${preview.eventCount} 条脱敏后的会话事件发送到 ${preview.destination} 的已配置模型进行提炼？原始记录不会发送；摘要会先保存在本机草稿中。` +
        `\n脱敏 ${preview.redactedCount} 条，预算遗漏/截断 ${preview.omittedEventCount} 条，采集缺口 ${preview.captureGaps} 条。`,
      { modal: true }, "确认发送脱敏输入",
    );
    if (consent !== "确认发送脱敏输入") return;
    const lockStore = new GitRefLockStore(context.globalStorageUri.fsPath);
    const lockKey = `session-memory-extract:${sha256(JSON.stringify({ scope, inputDigest: input.inputDigest }))}`;
    const lock = await lockStore.tryAcquire(lockKey, { kind: "session-memory-write", hostPid: process.pid }, (record) => !isRunningProcess(record.hostPid));
    if (!lock) { void vscode.window.showInformationMessage("相同会话输入正在另一扩展进程中提炼；为避免重复请求，本次未发送。稍后使用“审核或导出会话记忆”查看结果。"); return; }
    let draft: MemoryDraftV1 | undefined;
    let draftSnapshot = snapshot;
    try {
      const existingRows = await drafts.listDrafts(scope);
      const existing = existingRows.find((entry) => entry.inputDigest === input.inputDigest);
      if (existing) {
        draft = existing;
        draftSnapshot = await snapshotStore.loadSnapshot(existing.snapshotId, scope);
      } else {
        const rawCandidate = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "AgileCampus：提炼会话记忆",
          cancellable: false,
        }, async () => api.extractSessionMemory(input));
        const candidate = validateMemoryCandidate(rawCandidate, input);
        const parentDraft = existingRows.find((entry) => entry.status === "accepted");
        draft = await drafts.createDraft(candidate, input, snapshot, {
          parentMemoryId: parentDraft?.memoryId ?? null,
          ...(parentDraft ? { parentDraft } : {}),
        });
      }
    } finally { await lock.release(); }
    if (!draft) throw new Error("记忆候选没有成功保存；可使用同一会话重新尝试");
    if (draft.snapshotId !== snapshot.snapshotId) void vscode.window.showInformationMessage("已找到完全相同输入的本机记忆版本，本次没有再次调用模型。");
    else void vscode.window.showInformationMessage(`AI 候选已保存为本机草稿（${draft.provenance.model}）。原始会话记录未上传；请逐条核对出处后接受。`);
    await reviewDraft(context, draft, draftSnapshot, drafts);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "会话记忆提炼失败");
  }
}

async function reviewSavedDraft(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage("查看会话记忆需要先信任当前工作区。"); return; }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  try {
    const api = createApi(context, selected);
    const actor = await api.getCurrentActor();
    const { binding } = await selectLocalSession(context, selected);
    const scope = await makeScope(selected, binding, actor.id);
    const drafts = new MemoryDraftStore(context.globalStorageUri.fsPath);
    const rows = await drafts.listDrafts(scope);
    if (!rows.length) { void vscode.window.showInformationMessage("当前会话还没有本机记忆草稿。"); return; }
    const selectedDraft = await vscode.window.showQuickPick(rows.map((draft) => ({
      label: `r${draft.revision} · ${draft.status === "accepted" ? "已接受" : "待审核"}`,
      description: `${draft.provenance.model} · ${new Date(draft.updatedAt).toLocaleString()}`,
      detail: `${draft.items.goal.length} 个目标 · ${draft.items.completed.length} 个完成项 · ${draft.items.remaining.length} 个待办 · ${draft.tests.length} 条测试记录`,
      draft,
    })), { title: "选择本机会话记忆草稿" });
    if (!selectedDraft) return;
    const snapshots = new MemorySnapshotStore(context.globalStorageUri.fsPath);
    const snapshot = await snapshots.loadSnapshot(selectedDraft.draft.snapshotId, scope);
    await reviewDraft(context, selectedDraft.draft, snapshot, drafts);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法载入本机记忆草稿");
  }
}

async function reviewDraft(
  context: vscode.ExtensionContext,
  initial: MemoryDraftV1,
  snapshot: Awaited<ReturnType<MemorySnapshotStore["loadSnapshot"]>>,
  store: MemoryDraftStore,
): Promise<void> {
  let draft = initial;
  while (true) {
    const choices: ReviewQuickPickItem[] = [];
    for (const category of CATEGORIES) for (const entry of draft.items[category]) {
      choices.push({ choice: { kind: "item", category, entry },
        label: `${CATEGORY_LABELS[category]} · ${entry.text.slice(0, 90)}`,
        description: `${entry.origin === "human" ? "人工" : "AI"} · ${entry.disposition} · 出处 ${entry.evidenceRefs.length}`,
        detail: entry.text });
    }
    for (const entry of draft.tests) choices.push({ choice: { kind: "test", entry },
      label: `测试 · ${entry.command.slice(0, 90)}`,
      description: `${entry.origin === "human" ? "人工" : "AI"} · ${entry.support}${entry.exitCode === null ? " · 无退出码" : ` · exit ${entry.exitCode}`} · 出处 ${entry.evidenceRefs.length}`,
      detail: entry.command });
    choices.push(
      { choice: { kind: "action", action: "add-item" }, label: "＋ 添加记忆条目", description: "人工补充会标记来源" },
      { choice: { kind: "action", action: "add-test" }, label: "＋ 添加测试记录", description: "必须明确测试出处与证据类型" },
      { choice: { kind: "action", action: "accept" }, label: "接受此版本并生成接班材料", description: `当前草稿 r${draft.revision}；接受后不可原地修改` },
      { choice: { kind: "action", action: "pause" }, label: "稍后继续", description: "保留当前本机草稿，不发布" },
    );
    const selectedChoice = await vscode.window.showQuickPick(choices, {
      title: `会话记忆审核 · r${draft.revision}${draft.status === "accepted" ? "（只读）" : ""}`,
      placeHolder: "逐条选择内容查看出处、修改或删除；AI 判断不能替代人工核对",
    });
    const choice = selectedChoice?.choice;
    if (!choice || choice.kind === "action" && choice.action === "pause") return;
    if (choice.kind === "action") {
      if (choice.action === "add-item") {
        if (draft.status === "accepted") { void vscode.window.showInformationMessage("已接受版本不可修改；请另建新提炼版本。"); continue; }
        draft = await addItem(draft, snapshot, store);
        continue;
      }
      if (choice.action === "add-test") {
        if (draft.status === "accepted") { void vscode.window.showInformationMessage("已接受版本不可修改；请另建新提炼版本。"); continue; }
        draft = await addTest(draft, snapshot, store);
        continue;
      }
      if (choice.action === "accept") {
        if (draft.status === "accepted") {
          await exportAccepted(context, draft, snapshot);
          return;
        }
        const consent = await vscode.window.showWarningMessage(
          "接受后会生成不可变的记忆版本。接班材料只包含整理后的记忆、出处 ID 和 Git 基线，不含原始对话；此操作不会上传或启动 Agent。",
          { modal: true }, "接受并生成材料",
        );
        if (consent !== "接受并生成材料") continue;
        const accepted = await store.acceptDraft(draft.draftId, draft.revision, snapshot);
        await persistAndPresent(context, accepted.draft, accepted.document, snapshot);
        return;
      }
    }
    if (choice.kind === "item") {
      await openEvidence(snapshot, choice.entry.evidenceRefs);
      if (draft.status === "accepted") continue;
      const action = await vscode.window.showQuickPick([
        { label: "修改文字", value: "edit" }, { label: "删除此条目", value: "delete" }, { label: "返回", value: "back" },
      ], { title: `${CATEGORY_LABELS[choice.category]} · ${choice.entry.origin === "human" ? "人工条目" : "AI 候选"}` });
      if (!action || action.value === "back") continue;
      if (action.value === "edit") {
        const text = await vscode.window.showInputBox({ title: "修改记忆条目", value: choice.entry.text, ignoreFocusOut: true, validateInput: (value) => value.trim() ? undefined : "内容不能为空" });
        if (text === undefined) continue;
        draft = await store.applyDraftPatch(draft.draftId, draft.revision, { type: "edit-item", category: choice.category, itemId: choice.entry.id, text }, snapshot);
      } else if (action.value === "delete") {
        const confirm = await vscode.window.showWarningMessage("删除只从此记忆版本移除该条目，原始会话记录仍保留。", { modal: true }, "删除条目");
        if (confirm === "删除条目") draft = await store.applyDraftPatch(draft.draftId, draft.revision, { type: "delete-item", category: choice.category, itemId: choice.entry.id }, snapshot);
      }
      continue;
    }
    if (choice.kind !== "test") continue;
    await openEvidence(snapshot, choice.entry.evidenceRefs);
    if (draft.status === "accepted") continue;
    const action = await vscode.window.showQuickPick([
      { label: "修改测试记录", value: "edit" }, { label: "删除测试记录", value: "delete" }, { label: "返回", value: "back" },
    ], { title: `测试记录 · ${choice.entry.support}` });
    if (!action || action.value === "back") continue;
    if (action.value === "edit") {
      const command = await vscode.window.showInputBox({ title: "测试命令", value: choice.entry.command, ignoreFocusOut: true, validateInput: (value) => value.trim() ? undefined : "测试描述不能为空" });
      if (command === undefined) continue;
      const exitCodeText = await vscode.window.showInputBox({ title: "实际退出码", value: choice.entry.exitCode === null ? "" : String(choice.entry.exitCode), prompt: "未知可留空；此处不会运行命令。", ignoreFocusOut: true });
      if (exitCodeText === undefined) continue;
      const exitCode = exitCodeText.trim() ? Number(exitCodeText) : null;
      if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < -255 || exitCode > 255)) { void vscode.window.showErrorMessage("退出码必须是 -255 到 255 的整数，未知请留空。"); continue; }
      draft = await store.applyDraftPatch(draft.draftId, draft.revision, { type: "edit-test", testId: choice.entry.id, command, exitCode }, snapshot);
    } else if (action.value === "delete") {
      const confirm = await vscode.window.showWarningMessage("删除只从此记忆版本移除该测试记录，原始会话记录仍保留。", { modal: true }, "删除测试");
      if (confirm === "删除测试") draft = await store.applyDraftPatch(draft.draftId, draft.revision, { type: "delete-test", testId: choice.entry.id }, snapshot);
    }
  }
}

async function addItem(draft: MemoryDraftV1, snapshot: Parameters<MemoryDraftStore["applyDraftPatch"]>[3], store: MemoryDraftStore): Promise<MemoryDraftV1> {
  const categoryChoice = await vscode.window.showQuickPick(CATEGORIES.map((category) => ({ label: CATEGORY_LABELS[category], category })), { title: "选择记忆类别" });
  if (!categoryChoice) return draft;
  const text = await vscode.window.showInputBox({ title: `添加${CATEGORY_LABELS[categoryChoice.category]}`, prompt: "人工补充；可在下一步关联本次快照的出处。", ignoreFocusOut: true, validateInput: (value) => value.trim() ? undefined : "内容不能为空" });
  if (text === undefined) return draft;
  const refs = await selectEvidence(snapshot, `为“${text.slice(0, 36)}”选择出处（可跳过）`);
  if (refs.length > 10) { void vscode.window.showErrorMessage("每个记忆条目最多关联 10 条出处，请重新选择。"); return draft; }
  return store.applyDraftPatch(draft.draftId, draft.revision, { type: "add-item", category: categoryChoice.category, text, evidenceRefs: refs }, snapshot);
}

async function addTest(draft: MemoryDraftV1, snapshot: Parameters<MemoryDraftStore["applyDraftPatch"]>[3], store: MemoryDraftStore): Promise<MemoryDraftV1> {
  const command = await vscode.window.showInputBox({ title: "添加测试记录", prompt: "填写真实执行过的命令或测试说明；不会在此运行。", ignoreFocusOut: true, validateInput: (value) => value.trim() ? undefined : "测试说明不能为空" });
  if (command === undefined) return draft;
  const support = await vscode.window.showQuickPick([
    { label: "captured · 事件中有实际工具命令与结果", value: "captured" as const },
    { label: "reported · 仅有口头说明", value: "reported" as const },
  ], { title: "测试证据类型" });
  if (!support) return draft;
  const refs = await selectEvidence(snapshot, "选择包含测试命令/结果或口头说明的事件");
  if (!refs.length) { void vscode.window.showErrorMessage("测试记录必须关联至少一个来源事件。"); return draft; }
  if (refs.length > 10) { void vscode.window.showErrorMessage("每条测试记录最多关联 10 条出处，请重新选择。"); return draft; }
  const exitCodeText = await vscode.window.showInputBox({ title: "实际退出码", prompt: "未知请留空；不会运行测试。", ignoreFocusOut: true });
  if (exitCodeText === undefined) return draft;
  const exitCode = exitCodeText.trim() ? Number(exitCodeText) : null;
  if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < -255 || exitCode > 255)) { void vscode.window.showErrorMessage("退出码必须是 -255 到 255 的整数。"); return draft; }
  const patch: MemoryDraftPatch = { type: "add-test", command, exitCode, evidenceRefs: refs, support: support.value };
  return store.applyDraftPatch(draft.draftId, draft.revision, patch, snapshot);
}

async function exportAccepted(context: vscode.ExtensionContext, draft: MemoryDraftV1, snapshot: Parameters<MemoryDraftStore["acceptDraft"]>[2]): Promise<void> {
  const document = buildAcceptedMemoryDocument(draft, snapshot);
  await persistAndPresent(context, draft, document, snapshot);
}

async function persistAndPresent(context: vscode.ExtensionContext, draft: MemoryDraftV1, document: MemoryDocumentV1, snapshot: Parameters<MemoryDraftStore["acceptDraft"]>[2]): Promise<void> {
  const artifacts = new MemoryArtifactStore(context.globalStorageUri.fsPath);
  const events = new Set(snapshot.events.map((event) => event.id));
  const memoryPath = await artifacts.saveAcceptedDocument(document, events);
  const material = buildHandoffMaterial(draft, snapshot, draft.revision, () => stableMaterialId(draft.memoryId, draft.revision));
  const materialPath = await artifacts.saveHandoffMaterial(material);
  const handoff = createMemoryHandoffExport(document, material);
  const lines = [
    `AgileCampus · 会话记忆接班材料 r${material.revision}`,
    `项目 ${material.scope.projectId} / 任务 ${material.scope.taskId}`,
    `基线 ${material.baseSha} · 来源序号 ${material.sourceRange.from}–${material.sourceRange.to}`,
    `采集状态 ${material.completeness} · 缺口 ${material.sourceRange.gaps.length} · 未进入提炼 ${material.sourceRange.omittedEventIds.length} · 截断 ${material.sourceRange.truncatedEventIds.length}`,
    `AI ${document.provenance.model} · 输入摘要 ${document.inputDigest}`,
    "",
    renderMaterial(material),
    "",
    `本机不可变记忆：${memoryPath}`,
    `本机接班材料：${materialPath}`,
    "尚未上传、共享或启动 Agent。导出文件不包含原始会话正文，但包含项目/任务/记忆标识与整理后的工作记忆。",
  ];
  const view = await vscode.workspace.openTextDocument({ language: "plaintext", content: lines.join("\n") });
  await vscode.window.showTextDocument(view, { preview: true });
  const action = await vscode.window.showInformationMessage("记忆版本和接班材料已保存到 VS Code 本机私有存储。", "导出 JSON 以手动传递");
  if (action !== "导出 JSON 以手动传递") return;
  const consent = await vscode.window.showWarningMessage(
    "导出文件不加密，包含项目/任务标识和整理后的工作记忆；不含原始对话、模型凭据或本机路径。请只通过可信渠道传给接班人，不要放入公开仓库。",
    { modal: true }, "继续选择导出位置",
  );
  if (consent !== "继续选择导出位置") return;
  const uri = await vscode.window.showSaveDialog({
    title: "导出 AgileCampus 接班记忆（不含原始会话）",
    defaultUri: vscode.Uri.file(`agilecampus-memory-r${draft.revision}.json`),
    filters: { "AgileCampus JSON": ["json"] },
  });
  if (!uri) return;
  try {
    await new MemoryArtifactStore(context.globalStorageUri.fsPath).export(handoff, uri.fsPath);
    void vscode.window.showInformationMessage(`接班 JSON 已导出：${uri.fsPath}`);
  } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "接班 JSON 导出失败"); }
}

function renderMaterial(material: ReturnType<typeof buildHandoffMaterial>): string {
  const sections: Array<[string, string[]]> = [
    ["目标", material.goal], ["约束", material.constraints], ["已完成", material.completed],
    ["待完成", material.remaining], ["决策", material.decisions], ["失败方案", material.rejectedApproaches],
    ["阻塞", material.blockers], ["下一步", material.nextActions],
    ["测试记录", material.tests.map((test) => `${test.command} · ${test.support} · ${test.exitCode === null ? "退出码未知" : `exit ${test.exitCode}`}`)],
    ["待核对", material.uncertainItems.map((item) => `${item.category} · ${item.text}`)],
  ];
  return sections.filter(([, items]) => items.length).map(([title, items]) => `${title}\n${items.map((item) => `- ${item}`).join("\n")}`).join("\n\n");
}

async function openEvidence(snapshot: Parameters<MemoryDraftStore["acceptDraft"]>[2], eventIds: string[]): Promise<void> {
  const byId = new Map(snapshot.events.map((event) => [event.id, event]));
  const lines = eventIds.flatMap((id) => {
    const event = byId.get(id);
    return event ? [`[${event.sequence}] ${event.kind} · ${event.timestamp ?? "无时间戳"} · ${event.id}`, ...(event.command ? [`命令：${event.command}`] : []), event.text, ""] : [`来源事件不存在：${id}`, ""];
  });
  const document = await vscode.workspace.openTextDocument({ language: "plaintext", content: lines.join("\n") });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function selectEvidence(snapshot: Parameters<MemoryDraftStore["acceptDraft"]>[2], title: string): Promise<string[]> {
  const picks = await vscode.window.showQuickPick(snapshot.events.map((event) => ({
    label: `[${event.sequence}] ${event.kind}${event.command ? ` · ${event.command}` : ""}`,
    description: event.id,
    detail: event.text.slice(0, 180),
    id: event.id,
  })), { title, canPickMany: true, placeHolder: "可多选；按 Escape 跳过" });
  return picks?.map((item) => item.id) ?? [];
}

async function selectLocalSession(context: vscode.ExtensionContext, selected: BoundWorkspace): Promise<{ binding: LocalSessionBinding; sessionStore: LocalSessionStore }> {
  const sessionStore = new LocalSessionStore(context.globalStorageUri.fsPath);
  const bindings = await sessionStore.list(selected.folder.uri.fsPath, selected.binding.projectId);
  const rows = [];
  for (const binding of bindings) {
    const summary = await sessionStore.summary(binding.sessionKey);
    if (summary.eventCount > 0) rows.push({
      label: `${binding.provider.toUpperCase()} · ${summary.eventCount} 条 · ${binding.recording ? "记录中" : "已停止"}`,
      description: `任务 ${binding.taskId} · ${summary.hasGaps || summary.captureFailures.length ? "存在采集缺口" : "无已知缺口"}`,
      detail: `会话 ${binding.sessionKey} · 最近记录 ${summary.lastSavedAt ?? "无"}`,
      binding,
    });
  }
  if (!rows.length) throw new Error("当前项目工作区没有可整理的本机会话记录。请先在项目面板关联 Codex 会话并产生记录。");
  const choice = await vscode.window.showQuickPick(rows, { title: "选择需要提炼的本机会话", placeHolder: "原始记录仍只在本机；接下来可先检查脱敏出站预览" });
  if (!choice) throw new Error("已取消会话选择");
  return { binding: choice.binding, sessionStore };
}

async function makeScope(selected: BoundWorkspace, binding: LocalSessionBinding, actorId: string): Promise<MemoryScope> {
  const serverOrigin = new URL(selected.binding.serverOrigin).toString();
  return {
    serverOrigin,
    actorScope: sha256(`agilecampus-actor-v1\0${serverOrigin}\0${actorId}`),
    workspaceScope: await workspaceScopeHash(selected.folder.uri.fsPath),
    projectId: selected.binding.projectId,
    taskId: binding.taskId,
    sessionKey: binding.sessionKey,
  };
}

function createApi(context: vscode.ExtensionContext, selected: BoundWorkspace): AgileCampusApiClient {
  const tokenStore = new TokenStore(context.secrets);
  return new AgileCampusApiClient(selected.binding.serverOrigin, () => tokenStore.get(new URL(selected.binding.serverOrigin).origin, selected.binding.workspaceUri));
}

function isRunningProcess(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return !!error && typeof error === "object" && "code" in error && error.code === "EPERM"; }
}

async function showOutboundPreview(taskTitle: string, preview: ReturnType<typeof createExtractionPreview>, input: PreparedExtractionInputV1): Promise<void> {
  const lines = [
    "AgileCampus 会话记忆提炼 · 实际出站预览",
    `任务：${taskTitle}`,
    `目标服务：${preview.destination}`,
    `事件：${preview.eventCount} 条（序号 ${preview.sequenceRange.from}–${preview.sequenceRange.to}） · ${preview.outboundBytes} bytes`,
    `脱敏：${preview.redactedCount} 条 · 预算遗漏/截断：${preview.omittedEventCount} 条 · 采集缺口：${preview.captureGaps} 条 · 完整性：${preview.completeness}`,
    "说明：以下是唯一将发送的规范化内容；本机原始事件文件、原生会话 ID、绝对路径和未提交文件不会发送。秘密扫描只覆盖已知模式，不是完整 DLP。",
    `预算遗漏：${input.omissions.map((item) => `${item.eventId}（#${item.sequence} ${item.reason}）`).join("、") || "无"}`,
    "",
    "以下 JSON 即将作为请求正文发送：",
    JSON.stringify(input, null, 2),
    "",
    "关闭此预览或取消下一步，不会发送任何内容。",
  ];
  const doc = await vscode.workspace.openTextDocument({ language: "plaintext", content: lines.join("\n") });
  await vscode.window.showTextDocument(doc, { preview: true });
  await vscode.window.showInformationMessage("已打开逐条出站预览。检查正文后，命令会再次询问是否发送；取消即可停止。");
}

function stableMaterialId(memoryId: string, revision: number): string {
  const hex = sha256(`agilecampus-memory-material-v1\0${memoryId}\0${revision}`).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
