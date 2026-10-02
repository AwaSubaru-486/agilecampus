import * as vscode from "vscode";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { CheckpointStore } from "../checkpoints/store";
import { saveImportedCheckpoint } from "../checkpoints/import-store";
import { parseSharePackage, SharePackageError } from "../checkpoints/share-package";
import { createWorkspaceApi, selectBoundWorkspace } from "./checkpoint-support";
import { ServerCheckpointMappingStore } from "../checkpoints/server-mapping";

export function registerImportCheckpointCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.importCheckpoint", () => importCheckpoint(context)));
}

async function importCheckpoint(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage("导入检查点需要先信任当前 VS Code 工作区。");
    return;
  }
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const [file] = await vscode.window.showOpenDialog({
    title: "选择 AgileCampus 检查点 JSON",
    canSelectMany: false,
    filters: { "AgileCampus checkpoint": ["json"] },
  }) ?? [];
  if (!file) return;

  let packageData;
  try {
    const handle = await open(file.fsPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 15 * 1024 * 1024) throw new SharePackageError("导入文件不是普通文件，或超过 15 MiB");
      packageData = parseSharePackage(await handle.readFile());
    } finally { await handle.close(); }
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法安全读取检查点文件");
    return;
  }
  const manifest = packageData.value.manifest;
  if (new URL(manifest.serverOrigin).origin !== new URL(selected.binding.serverOrigin).origin || manifest.projectId !== selected.binding.projectId) {
    void vscode.window.showErrorMessage("交接包声明的服务或项目与当前工作区绑定不一致；为避免混入其他项目，本次未导入。");
    return;
  }
  if (packageData.value.artifacts.some((artifact) => artifact.kind === "transcript")) {
    const consent = await vscode.window.showWarningMessage(
      "交接包含原始会话 transcript。它可能包含完整提示词和工具输入输出；导入只保存在本机，不会启动命令或 Agent。",
      { modal: true }, "导入会话材料",
    );
    if (consent !== "导入会话材料") return;
  }

  const api = createWorkspaceApi(context, selected.binding);
  let taskVerified = false;
  try {
    const task = await api.getTask(manifest.taskId);
    taskVerified = task.id === manifest.taskId && task.projectId === manifest.projectId;
  } catch { /* Import remains local-only; execution will recheck online in E06. */ }
  let verifiedSourceServerCheckpointId: string | null = null;
  if (packageData.value.sourceServerCheckpointId) {
    try {
      const source = await api.getCheckpointIndex(packageData.value.sourceServerCheckpointId);
      if (source.id === packageData.value.sourceServerCheckpointId && source.projectId === manifest.projectId && source.taskId === manifest.taskId) {
        verifiedSourceServerCheckpointId = source.id;
      }
    } catch { /* Keep the package local; parent mapping will be retried by a later import. */ }
  }
  try {
    const imported = await saveImportedCheckpoint(new CheckpointStore(context.globalStorageUri.fsPath), manifest, packageData.artifacts);
    let parentMappingSaved = false;
    if (verifiedSourceServerCheckpointId) {
      try {
        await new ServerCheckpointMappingStore(context.workspaceState).set({
          serverOrigin: selected.binding.serverOrigin,
          projectId: manifest.projectId,
          taskId: manifest.taskId,
          localCheckpointId: packageData.value.sourceCheckpointId,
          serverCheckpointId: verifiedSourceServerCheckpointId,
        });
        parentMappingSaved = true;
      } catch { /* The local package remains usable; publishing its child stays blocked until the mapping is restored. */ }
    }
    const verification = taskVerified ? "任务归属已在线核对" : "项目/任务声明尚未在线核对，材料仅本机查看";
    const lineage = packageData.value.sourceServerCheckpointId
      ? parentMappingSaved ? "父检查点已与服务端核对" : "父检查点尚未在线核对，当前只能保留本地历史关系"
      : "交接包没有服务端父检查点映射，发布前需先建立父级映射";
    void vscode.window.showInformationMessage(`检查点已导入（${imported.repository.headSha.slice(0, 10)}）；${verification}；${lineage}。SHA-256 不证明发送者身份。`);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "保存导入检查点失败");
  }
}
