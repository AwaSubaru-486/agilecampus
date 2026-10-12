import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userModelConfigs } from "@/db/schema";
import { createUser } from "@/lib/user";
import { saveModelConfig } from "@/lib/model-config";
import { getModelForUser, resolveModelForUser } from "@/lib/agent/model";
import { narrateHealth } from "@/lib/agent/health-narrator";
import { resetDb } from "./helpers";

type Captured = { url: string; model: string; authorization: string | null };
function intercept(captured: Captured[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    captured.push({ url: String(input), model: body.model, authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ id: "synthetic-reply", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "模拟回复" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "Content-Type": "application/json" } });
  }));
}

describe("用户 API 自动路由", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "model-routing-test-secret");
    vi.stubEnv("DEEPSEEK_API_KEY", "site-test-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://site.test/v1");
    vi.stubEnv("DEEPSEEK_MODEL", "site-model");
    await resetDb();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("请求使用各自保存的地址、模型和密钥，配置更新后下一次调用立即生效", async () => {
    const a = await createUser({ name: "A", email: "a@routing.test", password: "password123" });
    const b = await createUser({ name: "B", email: "b@routing.test", password: "password123" });
    await saveModelConfig(a.id, { baseUrl: "https://personal-a.test/v1/chat/completions/", model: "model-a", apiKey: "key-a" });
    await saveModelConfig(b.id, { baseUrl: "https://personal-b.test/proxy/v1", model: "model-b", apiKey: "key-b" });
    const captured: Captured[] = []; intercept(captured);
    for (const actor of [a, b]) await generateText({ model: await getModelForUser(actor.id), prompt: "测试", maxRetries: 0 });
    await saveModelConfig(a.id, { baseUrl: "https://changed-a.test/v1", model: "model-a2", apiKey: "" });
    await generateText({ model: await getModelForUser(a.id), prompt: "测试更新", maxRetries: 0 });
    expect(captured).toEqual([
      { url: "https://personal-a.test/v1/chat/completions", model: "model-a", authorization: "Bearer key-a" },
      { url: "https://personal-b.test/proxy/v1/chat/completions", model: "model-b", authorization: "Bearer key-b" },
      { url: "https://changed-a.test/v1/chat/completions", model: "model-a2", authorization: "Bearer key-a" },
    ]);
  });

  it("健康综述也使用登录用户的个人配置；没有个人配置才使用站点服务", async () => {
    const a = await createUser({ name: "A", email: "a@routing.test", password: "password123" });
    const b = await createUser({ name: "B", email: "b@routing.test", password: "password123" });
    await saveModelConfig(a.id, { baseUrl: "https://personal.test/v1", model: "my-model", apiKey: "my-key" });
    const captured: Captured[] = []; intercept(captured);
    await narrateHealth([], "测试项目", { actorId: a.id });
    const fallback = await resolveModelForUser(b.id);
    expect(fallback).toMatchObject({ modelName: "site-model", source: "site" });
    await generateText({ model: fallback.model, prompt: "测试", maxRetries: 0 });
    expect(captured.map(item => [item.url, item.model])).toEqual([["https://personal.test/v1/chat/completions", "my-model"], ["https://site.test/v1/chat/completions", "site-model"]]);
  });

  it("旧配置中保存了完整接口地址也可自动识别；坏密钥不会悄悄切到站点 API", async () => {
    const a = await createUser({ name: "A", email: "a@routing.test", password: "password123" });
    await saveModelConfig(a.id, { baseUrl: "https://personal.test/v1", model: "my-model", apiKey: "my-key" });
    await db.update(userModelConfigs).set({ baseUrl: "https://personal.test/v1/chat/completions" }).where(eq(userModelConfigs.userId, a.id));
    const captured: Captured[] = []; intercept(captured);
    await generateText({ model: await getModelForUser(a.id), prompt: "测试", maxRetries: 0 });
    expect(captured[0].url).toBe("https://personal.test/v1/chat/completions");
    await db.update(userModelConfigs).set({ encryptedKey: "broken-encrypted-key" }).where(eq(userModelConfigs.userId, a.id));
    await expect(getModelForUser(a.id)).rejects.toThrow("重新保存密钥");
    expect(captured).toHaveLength(1);
  });
});
