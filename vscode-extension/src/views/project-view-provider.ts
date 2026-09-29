import * as vscode from "vscode";
import { AgileCampusApiClient } from "../agilecampus/api-client";
import type { ProjectSnapshot, WebviewMessage } from "../types";

export class ProjectViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agilecampus.projectView";
  private view?: vscode.WebviewView;
  private snapshot: ProjectSnapshot = {
    projectName: "尚未加载",
    projectId: null,
    repository: null,
    currentBranch: null,
    myTasks: [],
    blockers: [],
  };

  constructor(private readonly extensionUri: vscode.Uri, private readonly client: AgileCampusApiClient) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message));
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.snapshot = await this.client.getSnapshot();
    this.view?.webview.postMessage({ type: "snapshot", snapshot: this.snapshot });
  }

  openProject(): void {
    void vscode.env.openExternal(vscode.Uri.parse(this.client.webUrl("/projects")));
  }

  continueAiWork(taskId?: string): void {
    const path = taskId ? `/projects?space=studio&task=${encodeURIComponent(taskId)}` : "/projects?space=studio";
    void vscode.env.openExternal(vscode.Uri.parse(this.client.webUrl(path)));
  }

  reportBlocker(taskId?: string): void {
    const path = taskId ? `/projects?space=work&task=${encodeURIComponent(taskId)}` : "/collaboration";
    void vscode.env.openExternal(vscode.Uri.parse(this.client.webUrl(path)));
  }

  private handleMessage(message: WebviewMessage): void {
    if (message.type === "refresh") return void this.refresh();
    if (message.type === "openProject") return this.openProject();
    if (message.type === "continueAiWork") return this.continueAiWork(message.taskId);
    if (message.type === "reportBlocker") return this.reportBlocker(message.taskId);
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta http-equiv="Content-Security-Policy" content="${csp}"><title>AgileCampus</title></head><body><div id="root"></div><script nonce="${nonce}">window.acquireVsCodeApi = acquireVsCodeApi;</script><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 24 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
