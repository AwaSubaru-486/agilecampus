import * as vscode from "vscode";
import { MemoryArtifactStore, parseMemoryHandoffExport } from "../memory/artifact-store";
import { buildResumeContext } from "../memory/handoff-material";
import { sha256, workspaceScopeHash } from "../memory/input-snapshot";
import type { MemoryScope } from "../memory/types";
import { readRepositorySnapshot } from "../git/repository-service";
import { createWorkspaceApi, getLocalOnlyRepositoryId, selectBoundWorkspace } from "./checkpoint-support";

const MAX_HANDOFF_BYTES = 2 * 1024 * 1024;

export function registerImportMemoryHandoffCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.importMemoryHandoff", () => importMemoryHandoff(context)));
}

async function importMemoryHandoff(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage("核对接班材料前，请先信任当前 VS Code 工作区。"); return; }
  const files = await vscode.window.showOpenDialog({
    title: "选择发送者导出的 AgileCampus 接班 JSON",
    canSelectMany: false,
    filters: { "AgileCampus JSON": ["json"] },
  });
  if (!files?.length) return;
  try {
    const bytes = await vscode.workspace.fs.readFile(files[0]);
    if (bytes.byteLength > MAX_HANDOFF_BYTES) throw new Error("接班 JSON 超过 2 MiB 限制；未导入");
    let raw: unknown;
    try { raw = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
    catch { throw new Error("接班 JSON 无法解析；原文件未修改"); }
    const handoff = parseMemoryHandoffExport(raw);
    const selected = await selectBoundWorkspace(context);
    if (!selected) return;
    const expectedServer = new URL(selected.binding.serverOrigin).toString();
    if (handoff.material.scope.serverOrigin !== expectedServer || handoff.material.scope.projectId !== selected.binding.projectId) {
      throw new Error("接班材料来自其他服务或项目；请切换到匹配的 AgileCampus 工作区");
    }

    const api = createWorkspaceApi(context, selected.binding);
    const actor = await api.getCurrentActor();
    let accessConfirmed = false;
    let taskTitle = handoff.material.scope.taskId;
    try {
      const task = await api.getTask(handoff.material.scope.taskId);
      accessConfirmed = task.id === handoff.material.scope.taskId && task.projectId === selected.binding.projectId;
      if (accessConfirmed) taskTitle = task.title;
    } catch { /* Keep explicit access blocker in the receiver report. */ }

    const receiverScope: MemoryScope = {
      serverOrigin: expectedServer,
      actorScope: sha256(`agilecampus-actor-v1\0${expectedServer}\0${actor.id}`),
      workspaceScope: await workspaceScopeHash(selected.folder.uri.fsPath),
      projectId: selected.binding.projectId,
      taskId: handoff.material.scope.taskId,
      sessionKey: handoff.material.scope.sessionKey,
    };
    let repositoryKeyHash: string | null = null;
    let currentHeadSha: string | null = null;
    let workspaceReady = false;
    let workspaceClean = false;
    let workspaceBlockers: string[] = [];
    try {
      const repository = await readRepositorySnapshot(selected.folder.uri.fsPath, await getLocalOnlyRepositoryId(context, selected.folder.uri.toString()));
      repositoryKeyHash = sha256(repository.key);
      currentHeadSha = repository.headSha;
      workspaceReady = true;
      workspaceClean = !repository.dirty;
      workspaceBlockers = [...repository.recoveryBlockers];
    } catch { /* A missing/invalid repository is a visible receiver blocker, never guessed. */ }

    const resume = buildResumeContext(handoff.material, {
      repositoryKeyHash, currentHeadSha, workspaceReady, workspaceClean,
      workspaceBlockers, receivedRevision: handoff.memory.revision, accessConfirmed,
    });
    const storedPath = await new MemoryArtifactStore(context.globalStorageUri.fsPath).saveReceivedExport(handoff, receiverScope);
    const report = [
      `AgileCampus 接班核对 · ${resume.ready ? "可以粘贴到 Agent" : "未通过，不要直接开始"}`,
      `任务：${taskTitle}`,
      `记忆版本：r${handoff.memory.revision} · 基线 ${handoff.material.baseSha}`,
      `当前仓库：${currentHeadSha ?? "不可读取"}`,
      `接收材料已保存在本机：${storedPath}`,
      "",
      ...(resume.blockers.length ? ["未通过项：", ...resume.blockers.map((blocker) => `- ${blocker}`), ""] : ["仓库身份、Git 基线、任务访问和接收版本均匹配。", ""]),
      resume.instructions,
      "",
      "此命令只核对并准备文本；不会创建 worktree、改文件、提交任务或启动 Agent。",
    ];
    const document = await vscode.workspace.openTextDocument({ language: "plaintext", content: report.join("\n") });
    await vscode.window.showTextDocument(document, { preview: true });
    if (!resume.ready) {
      void vscode.window.showErrorMessage(`接班材料已保存在本机，但有 ${resume.blockers.length} 项未通过；请先让队友处理仓库/worktree/权限问题。`);
      return;
    }
    const action = await vscode.window.showInformationMessage("核对通过。复制整理后的记忆文本到 Codex/Claude 新会话，可让 Agent 从记录的断点继续；不会自动启动。", "复制接班上下文");
    if (action === "复制接班上下文") {
      await vscode.env.clipboard.writeText(resume.instructions);
      void vscode.window.showInformationMessage("接班上下文已复制。请粘贴到目标 Agent 会话；启动前仍应让它读取当前代码并核对基线。");
    }
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "导入接班材料失败");
  }
}
