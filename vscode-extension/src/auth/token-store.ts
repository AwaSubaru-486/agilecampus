import { createHash } from "node:crypto";
import type * as vscode from "vscode";

const TOKEN_PREFIX = "agileCampus.personalToken.";

function secretKey(serverOrigin: string): string {
  return TOKEN_PREFIX + createHash("sha256").update(serverOrigin).digest("hex");
}

export class TokenStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(serverOrigin: string): Promise<string | undefined> {
    return await this.secrets.get(secretKey(serverOrigin));
  }

  async store(serverOrigin: string, token: string): Promise<void> {
    await this.secrets.store(secretKey(serverOrigin), token);
  }

  async delete(serverOrigin: string): Promise<void> {
    await this.secrets.delete(secretKey(serverOrigin));
  }
}
