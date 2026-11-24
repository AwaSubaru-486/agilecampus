import { createHash } from "node:crypto";
import type * as vscode from "vscode";

const TOKEN_PREFIX = "agileCampus.personalToken.";

function secretKey(serverOrigin: string, workspaceUri: string): string {
  return TOKEN_PREFIX + createHash("sha256").update(`${serverOrigin}\n${workspaceUri}`).digest("hex");
}

export class TokenStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(serverOrigin: string, workspaceUri: string): Promise<string | undefined> {
    return await this.secrets.get(secretKey(serverOrigin, workspaceUri));
  }

  async store(serverOrigin: string, workspaceUri: string, token: string): Promise<void> {
    await this.secrets.store(secretKey(serverOrigin, workspaceUri), token);
  }

  async delete(serverOrigin: string, workspaceUri: string): Promise<void> {
    await this.secrets.delete(secretKey(serverOrigin, workspaceUri));
  }
}
