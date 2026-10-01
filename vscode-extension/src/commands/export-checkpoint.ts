import * as vscode from "vscode";
import { open } from "node:fs/promises";
import * as path from "node:path";
import { CheckpointStore } from "../checkpoints/store";
import { createSharePackage, findObviousSecrets, SharePackageError } from "../checkpoints/share-package";
import type { NewCheckpointArtifact } from "../checkpoints/types";
import { selectBoundWorkspace } from "./checkpoint-support";

export function registerExportCheckpointCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.exportCheckpoint", () => exportCheckpoint(context)));
}

async function exportCheckpoint(context: vscode.ExtensionContext): Promise<void> {
  const selected = await selectBoundWorkspace(context);
  if (!selected) return;
  const store = new CheckpointStore(context.globalStorageUri.fsPath);
  try {
    const records = await store.list(selected.binding.serverOrigin, selected.binding.projectId);
    if (!records.length) { void vscode.window.showInformationMessage("此项目在本机没有可导出的检查点。"); return; }
    const chosen = await vscode.window.showQuickPick(records.map(({ manifest }) => ({
      label: manifest.handoff.goal,
      description: `${manifest.repository.headSha.slice(0, 10)} · ${new Date(manifest.capturedAt).toLocaleString()}`,
      id: manifest.id,
    })), { title: "选择要导出的检查点" });
    if (!chosen) return;
    const manifest = await store.read(selected.binding.serverOrigin, selected.binding.projectId, chosen.id);
    if (!manifest) throw new SharePackageError("检查点已不存在");
    const chosenArtifacts: NewCheckpointArtifact[] = [];
    if (manifest.artifacts.length) {
      const picks = await vscode.window.showQuickPick(manifest.artifacts.map((artifact) => ({
        label: artifact.kind === "context" ? "附加上下文材料" : "附加原始 Agent transcript",
        description: `${Math.ceil(artifact.byteLength / 1024)} KiB · SHA-256 ${artifact.sha256.slice(0, 12)}`,
        picked: artifact.kind === "context",
        artifact,
      })), { title: "选择分享附件", canPickMany: true, placeHolder: "transcript 默认不选；未选择的附件不会导出" });
      if (!picks) return;
      for (const pick of picks) {
        const content = await store.readArtifact(selected.binding.serverOrigin, selected.binding.projectId, manifest.id, pick.artifact.id);
        if (!content) throw new SharePackageError("所选附件不存在");
        chosenArtifacts.push({ kind: pick.artifact.kind, content });
      }
      // Keep the source IDs paired with the selected bytes for the package builder.
      const withIds = chosenArtifacts.map((artifact, index) => ({ ...artifact, id: picks[index].artifact.id }));
      const secretLocations = inspectSecrets(manifest, withIds);
      if (secretLocations.length) {
        void vscode.window.showErrorMessage(`检测到明显凭据模式：${secretLocations.join("、")}。本次未导出。请移除含凭据的材料，另存新检查点后重试。`);
        return;
      }
      const transcript = withIds.filter((item) => item.kind === "transcript");
      if (transcript.length) {
        const preview = await vscode.workspace.openTextDocument({ language: "json", content: Buffer.from(transcript[0].content).toString("utf8") });
        await vscode.window.showTextDocument(preview, { preview: true });
        const consent = await vscode.window.showWarningMessage(
          "原始 transcript 可能包含完整提示词、模型回复和工具输入输出。请先查看内容，再单独确认将它放入分享文件。",
          { modal: true }, "确认包含 transcript",
        );
        if (consent !== "确认包含 transcript") return;
      }
      const payload = createSharePackage(manifest, withIds);
      await writeNewPackage(payload.bytes);
      return;
    }
    const secretLocations = inspectSecrets(manifest, []);
    if (secretLocations.length) {
      void vscode.window.showErrorMessage(`交接文本中检测到明显凭据模式：${secretLocations.join("、")}。请修订后新建检查点再导出。`);
      return;
    }
    const payload = createSharePackage(manifest, []);
    await writeNewPackage(payload.bytes);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "导出检查点失败");
  }
}

function inspectSecrets(manifest: { handoff: { goal: string; completed: string[]; remaining: string[]; blocker: string | null; rejectedApproaches: string[]; nextAction: string } }, artifacts: Array<{ id: string; kind: string; content: Uint8Array }>): string[] {
  const findings = new Set<string>();
  const handoff = [manifest.handoff.goal, ...manifest.handoff.completed, ...manifest.handoff.remaining,
    manifest.handoff.blocker ?? "", ...manifest.handoff.rejectedApproaches, manifest.handoff.nextAction].join("\n");
  for (const name of findObviousSecrets(handoff)) findings.add(`交接字段：${name}`);
  for (const artifact of artifacts) {
    for (const name of findObviousSecrets(Buffer.from(artifact.content).toString("utf8"))) findings.add(`${artifact.kind} 附件：${name}`);
  }
  return [...findings];
}

async function writeNewPackage(bytes: Buffer): Promise<void> {
  const destination = await vscode.window.showSaveDialog({
    title: "保存手工检查点交接包",
    saveLabel: "导出 JSON",
    filters: { "AgileCampus checkpoint": ["json"] },
  });
  if (!destination) return;
  const file = await open(destination.fsPath, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  void vscode.window.showInformationMessage(`交接包已导出到 ${path.basename(destination.fsPath)}。SHA-256 只用于完整性校验，不证明作者身份。`);
}
