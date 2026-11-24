import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { LocalSessionStore } from "../session-memory/local-store";
import type { NormalizedEventV1 } from "../../../shared/session-memory/types";

type RecordPanelRequest = { type: "ready" | "loadOlder" | "loadLatest" };
type RecordPanelResponse =
  | { type: "page"; mode: "replace" | "prepend"; events: NormalizedEventV1[]; total: number; hasOlder: boolean }
  | { type: "newEvents"; count: number }
  | { type: "error"; operation: "older" | "latest" | "poll"; message: string };

export class SessionRecordPanel implements vscode.Disposable {
  private static readonly openPanels = new Map<string, SessionRecordPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private poller?: NodeJS.Timeout;
  private nextBeforeSequence: number | null = null;
  private lastDisplayedSequence = 0;
  private disposed = false;

  static disposeAll(): void {
    for (const panel of this.openPanels.values()) panel.dispose();
  }

  static open(extensionUri: vscode.Uri, store: LocalSessionStore, sessionKey: string, title: string): SessionRecordPanel {
    const existing = this.openPanels.get(sessionKey);
    if (existing) { existing.panel.reveal(vscode.ViewColumn.Beside); return existing; }
    const opened = new SessionRecordPanel(extensionUri, store, sessionKey, title);
    this.openPanels.set(sessionKey, opened);
    return opened;
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(extensionUri: vscode.Uri, private readonly store: LocalSessionStore, private readonly sessionKey: string, title: string) {
    this.panel = vscode.window.createWebviewPanel("agilecampus.sessionRecord", `会话记录 · ${title}`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });
    this.panel.webview.html = this.html(extensionUri);
    this.disposables.push(this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (!isPanelRequest(raw)) return;
      if (raw.type === "ready" || raw.type === "loadLatest") void this.loadLatest();
      if (raw.type === "loadOlder") void this.loadOlder();
    }));
    this.disposables.push(this.panel.onDidChangeViewState(() => this.setPolling(this.panel.visible)));
    this.disposables.push(this.panel.onDidDispose(() => this.cleanup()));
    this.setPolling(this.panel.visible);
  }

  dispose(): void {
    this.cleanup();
    this.panel.dispose();
  }

  private cleanup(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.poller) clearInterval(this.poller);
    this.poller = undefined;
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    if (SessionRecordPanel.openPanels.get(this.sessionKey) === this) SessionRecordPanel.openPanels.delete(this.sessionKey);
  }

  private setPolling(enabled: boolean): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = undefined;
    if (!enabled) return;
    this.poller = setInterval(() => { void this.reportNewEvents(); }, 2500);
  }

  private async loadLatest(): Promise<void> {
    try {
      const page = await this.store.readEventsPage(this.sessionKey, { limit: 50 });
      this.nextBeforeSequence = page.nextBeforeSequence;
      this.lastDisplayedSequence = page.total;
      this.post({ type: "page", mode: "replace", events: page.events, total: page.total, hasOlder: page.hasOlder });
    } catch (error) { this.post({ type: "error", operation: "latest", message: errorText(error) }); }
  }

  private async loadOlder(): Promise<void> {
    if (this.nextBeforeSequence === null) return;
    try {
      const page = await this.store.readEventsPage(this.sessionKey, { beforeSequence: this.nextBeforeSequence, limit: 50 });
      this.nextBeforeSequence = page.nextBeforeSequence;
      this.post({ type: "page", mode: "prepend", events: page.events, total: page.total, hasOlder: page.hasOlder });
    } catch (error) { this.post({ type: "error", operation: "older", message: errorText(error) }); }
  }

  private async reportNewEvents(): Promise<void> {
    try {
      const summary = await this.store.summary(this.sessionKey);
      this.post({ type: "newEvents", count: Math.max(0, summary.latestSequence - this.lastDisplayedSequence) });
    } catch (error) { this.post({ type: "error", operation: "poll", message: errorText(error) }); }
  }

  private post(message: RecordPanelResponse): void { void this.panel.webview.postMessage(message); }

  private html(extensionUri: vscode.Uri): string {
    const nonce = randomUUID().replace(/-/g, "");
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "record-view.js"));
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"));
    const csp = `default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';`;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="${styleUri}"><title>AgileCampus 会话记录</title></head><body class="record-body"><header class="record-toolbar"><div><strong>本机会话记录</strong><span>仅存储于 VS Code 扩展本机数据目录；不会自动上传。</span></div><button id="refresh-records" class="text-button">重新读取</button></header><p id="record-status" role="status" aria-live="polite">正在读取本地事件…</p><button id="new-events" class="text-button" hidden></button><button id="load-older" class="text-button" hidden>加载更早记录</button><main id="record-list" aria-live="polite"></main><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }
}

function isPanelRequest(value: unknown): value is RecordPanelRequest {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    ["ready", "loadOlder", "loadLatest"].includes((value as { type?: string }).type ?? "");
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : "读取本地会话记录失败"; }
