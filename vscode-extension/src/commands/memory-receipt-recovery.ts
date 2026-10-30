import * as vscode from "vscode";
import { BindingStore } from "../workspace/binding-store";
import { ReceiptOutbox } from "../memory/receipt-outbox";
import { sha256, workspaceScopeHash } from "../memory/input-snapshot";
import { createWorkspaceApi, selectBoundWorkspace, type BoundWorkspace } from "./checkpoint-support";
import { ApiError } from "../agilecampus/api-client";

export function registerMemoryReceiptRecovery(context: vscode.ExtensionContext) {
  const outbox = new ReceiptOutbox(context.globalStorageUri.fsPath);
  let active = false;
  async function recover(selected?: BoundWorkspace) {
    if (active || !vscode.workspace.isTrusted) return { sent: 0, pending: 0, unreadable: 0 };
    active = true;
    const totals = { sent: 0, pending: 0, unreadable: 0 };
    try {
      const workspaces = selected ? [selected] : (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => {
        const binding = new BindingStore(context.workspaceState).get(folder.uri.toString());
        return binding ? [{ folder, binding }] : [];
      });
      for (const { folder, binding } of workspaces) {
        const scope = { serverOrigin: new URL(binding.serverOrigin).toString(), projectId: binding.projectId, workspaceScope: await workspaceScopeHash(folder.uri.fsPath) };
        const scan = await outbox.scanPending(scope);
        totals.unreadable = Math.max(totals.unreadable, scan.unreadable);
        const candidates = scan.addresses;
        if (!candidates.length) continue;
        const api = createWorkspaceApi(context, binding);
        try {
          const actor = await api.getCurrentActor();
          const actorScope = sha256(`agilecampus-actor-v1\0${scope.serverOrigin}\0${actor.id}`);
          for (const address of candidates.filter((item) => item.actorScope === actorScope).slice(0, 8)) {
            try {
              totals.sent += await outbox.flush(address, (sequence, progress) => api.reportTaskMemoryContinuation(address.projectId, address.taskId, {
                id: address.requestId, claimId: address.claimId, sequence, ...progress,
              }));
            } catch (error) {
              // Keep permanent conflicts for inspection, but do not let one offline endpoint stall every queued request.
              if (!(error instanceof ApiError) || error.status === null || error.status >= 500) break;
            }
          }
          totals.pending += (await outbox.scanPending({ ...scope, actorScope })).addresses.length;
        } catch { totals.pending += candidates.length; }
      }
      return totals;
    } finally { active = false; }
  }
  const automatic = () => { void recover().catch(() => undefined); };
  const timer = setInterval(automatic, 30_000);
  const initial = setTimeout(automatic, 1000);
  context.subscriptions.push({ dispose() { clearInterval(timer); clearTimeout(initial); } });
  context.subscriptions.push(vscode.commands.registerCommand("agilecampus.retryMemoryReceipts", async () => {
    if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage("请先信任当前工作区，再同步接续回执。"); return; }
    const selected = await selectBoundWorkspace(context);
    if (!selected) return;
    if (active) { void vscode.window.showInformationMessage("接续回执正在同步，请稍后查看网页进度。"); return; }
    try {
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "AgileCampus：补传接续回执", cancellable: false }, () => recover(selected));
      void vscode.window.showInformationMessage(result.unreadable ? `有 ${result.unreadable} 个本机回执文件无法读取，原文件已保留；其余可读取记录已尝试同步，另有 ${result.pending} 个请求待同步。` : result.pending ? `仍有 ${result.pending} 个请求待同步；请检查连接、账号与项目权限。已发送的回执不会重复创建。` : "接续回执同步完成，当前没有待同步记录。");
    } catch { void vscode.window.showErrorMessage("无法读取或同步本机接续回执，原记录已保留。请检查扩展存储和连接后重试。"); }
  }));
}
