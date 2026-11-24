import * as vscode from "vscode";
import { createHash, randomUUID } from "node:crypto";
import { AgileCampusApiClient } from "../agilecampus/api-client";
import { TokenStore } from "../auth/token-store";
import { BindingStore, type WorkspaceBinding } from "../workspace/binding-store";

export type BoundWorkspace = { folder: vscode.WorkspaceFolder; binding: WorkspaceBinding };

export async function selectBoundWorkspace(context: vscode.ExtensionContext): Promise<BoundWorkspace | undefined> {
  const bindings = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => {
    const binding = new BindingStore(context.workspaceState).get(folder.uri.toString());
    return binding ? [{ folder, binding }] : [];
  });
  if (!bindings.length) {
    void vscode.window.showErrorMessage("请先连接 AgileCampus 项目，再保存或查看本地检查点。");
    return undefined;
  }
  if (bindings.length === 1) return bindings[0];
  const selected = await vscode.window.showQuickPick(bindings.map((entry) => ({
    label: entry.folder.name,
    description: entry.binding.projectId,
    entry,
  })), { title: "选择项目工作区" });
  return selected?.entry;
}

export function createWorkspaceApi(context: vscode.ExtensionContext, binding: WorkspaceBinding): AgileCampusApiClient {
  const store = new TokenStore(context.secrets);
  return new AgileCampusApiClient(binding.serverOrigin, () => store.get(new URL(binding.serverOrigin).origin, binding.workspaceUri));
}

export async function getLocalOnlyRepositoryId(context: vscode.ExtensionContext, workspaceUri: string): Promise<string> {
  const digest = createHash("sha256").update(workspaceUri).digest("hex");
  const key = `agileCampus.localRepositoryId.${digest}`;
  let id = context.workspaceState.get<string>(key);
  if (!id) {
    id = randomUUID();
    await context.workspaceState.update(key, id);
  }
  return id;
}

export async function promptText(title: string, prompt: string, required: boolean): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    prompt,
    ignoreFocusOut: true,
    validateInput: (value) => required && !value.trim() ? "此项必填" : undefined,
  });
}

export function splitItems(value: string): string[] {
  return [...new Set(value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean))];
}
