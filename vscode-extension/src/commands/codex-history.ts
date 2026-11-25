import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { codexConfigDirectory } from "../session-memory/codex-hook-config";
import { listCodexHistory, readCodexHistory, type CodexHistory, type CodexHistoryEntry } from "../session-memory/codex-history";

const PREVIEW_SCHEME = "agilecampus-codex-history";
const command = "agilecampus.openCodexHistory";

type SessionChoice = vscode.QuickPickItem & { entry?: CodexHistoryEntry };

export function registerCodexHistoryCommand(context: vscode.ExtensionContext): void {
  const previews = new Map<string, string>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
      provideTextDocumentContent: (uri) => previews.get(uri.toString()) ?? "此预览已关闭，请重新选择会话。",
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === PREVIEW_SCHEME) previews.delete(document.uri.toString());
    }),
    vscode.commands.registerCommand(command, async () => {
      let openedDocument = false;
      let key: string | undefined;
      try {
        const selected = await chooseSession();
        if (!selected) return;
        const history = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification, title: "正在读取本地 Codex 对话", cancellable: true,
        }, async (_progress, cancellation) => {
          if (cancellation.isCancellationRequested) return;
          const controller = new AbortController();
          const listener = cancellation.onCancellationRequested(() => controller.abort());
          try { return await readCodexHistory(selected.file, controller.signal); }
          catch (error) {
            if (controller.signal.aborted) return;
            throw error;
          } finally { listener.dispose(); }
        });
        if (!history) return;
        if (!history.turns.length) {
          void vscode.window.showInformationMessage("这个 Codex 会话没有可预览的文本消息。");
          return;
        }
        const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: "/Codex 本地对话.txt", query: randomUUID() });
        key = uri.toString();
        previews.set(key, formatPreview(selected.title, history));
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
        openedDocument = true;
      } catch (error) {
        const detail = error instanceof Error && !("code" in error) ? error.message : "无法读取该本地文件，请检查文件路径和访问权限。";
        void vscode.window.showErrorMessage(detail);
      } finally {
        if (key && !openedDocument) previews.delete(key);
      }
    }),
  );
}

async function chooseSession(): Promise<{ file: string; title: string } | undefined> {
  const home = codexConfigDirectory();
  const recent = await listCodexHistory(home);
  const choices: SessionChoice[] = recent.map((entry) => ({
    label: entry.title ?? "Codex 对话",
    description: `${entry.date.slice(0, 10)} ${entry.date.slice(11).replace(/-/g, ":")}${entry.archived ? " · 已归档" : ""}`,
    detail: path.basename(entry.file),
    entry,
  }));
  const choice = await vscode.window.showQuickPick<SessionChoice>([
    { label: "选择其他 JSONL 文件…" },
    ...choices,
  ], {
    title: "查看本地 Codex 对话",
    placeHolder: "选择会话以查看本地文本预览",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!choice) return;
  if (choice.entry) return { file: choice.entry.file, title: choice.label };
  const picked = await vscode.window.showOpenDialog({
    title: "选择 Codex 会话文件",
    openLabel: "预览对话",
    defaultUri: vscode.Uri.file(recent.length ? path.dirname(recent[0].file) : home),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "Codex JSONL": ["jsonl"] },
  });
  const file = picked?.[0];
  if (!file) return;
  if (file.scheme !== "file") throw new Error("请选择当前 VS Code 扩展宿主可访问的本地文件。");
  return { file: file.fsPath, title: path.basename(file.fsPath) };
}

function formatPreview(title: string, history: CodexHistory): string {
  const header = [title, "只读本地预览 · 显示用户与 Codex 的文本消息"];
  if (history.earlierTurns) header.push(`已省略较早的 ${history.earlierTurns} 条消息。`);
  if (history.shortenedMessages) header.push(`有 ${history.shortenedMessages} 条长消息超出单条预览上限。`);
  if (history.omittedLines) header.push(`有 ${history.omittedLines} 行记录过长或不完整，已跳过。`);
  return [header.join("\n"), ...history.turns.map(({ role, text }) => `${role === "user" ? "你" : "Codex"}\n${text}`)].join("\n\n──────────\n\n");
}
