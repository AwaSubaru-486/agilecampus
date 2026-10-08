import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userModelConfigs } from "@/db/schema";
import { createUser } from "@/lib/user";
import { getModelConfigStatus, getPersonalModelConfig, saveModelConfig } from "@/lib/model-config";
import { getModelForUser } from "@/lib/agent/model";
import { resetDb } from "./helpers";

describe("个人 API 配置", () => {
  beforeEach(async () => { vi.stubEnv("AUTH_SECRET", "test-only-encryption-secret"); await resetDb(); });
  it("加密保存，状态不含密钥，不同用户隔离；留空保留密钥", async () => {
    const a = await createUser({ email: "api-a@test.local", name: "A", password: "password123" });
    const b = await createUser({ email: "api-b@test.local", name: "B", password: "password123" });
    await saveModelConfig(a.id, { baseUrl: "https://example.com/v1/", model: "test-model", apiKey: "test-only-api-secret" });
    const [row] = await db.select().from(userModelConfigs).where(eq(userModelConfigs.userId, a.id));
    expect(row.encryptedKey).not.toContain("test-only-api-secret");
    expect(await getPersonalModelConfig(a.id)).toEqual({ baseUrl: "https://example.com/v1", model: "test-model", apiKey: "test-only-api-secret" });
    expect(await getPersonalModelConfig(b.id)).toBeNull();
    expect(JSON.stringify(await getModelConfigStatus(a.id))).not.toContain("test-only-api-secret");
    await saveModelConfig(a.id, { baseUrl: "https://example.com/v1", model: "updated", apiKey: "" });
    expect((await getPersonalModelConfig(a.id))?.apiKey).toBe("test-only-api-secret");
    expect(await getModelForUser(a.id)).toMatchObject({ modelId: "updated" });
    await expect(saveModelConfig(b.id, { baseUrl: "https://example.com/v1", model: "new", apiKey: "" })).rejects.toThrow("API Key");
  });
  it("拒绝不合法的协议和含密钥的 URL", async () => {
    for (const baseUrl of ["file:///secret", "https://user:password@example.com/v1", "https://example.com/v1?key=secret"]) {
      await expect(saveModelConfig("00000000-0000-4000-8000-000000000001", { baseUrl, model: "test", apiKey: "test-only" })).rejects.toThrow();
    }
  });
});
