import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AppError } from "@/lib/errors";
import { getPersonalModelConfig, normalizeModelBaseUrl } from "@/lib/model-config";

// DeepSeek 已废弃 deepseek-chat 番号（现返 400 invalid_request_error），现行为 v4 系列。
// flash 迅捷省耗，适配项目管理助手的短问答+工具调用；重推理可经 DEEPSEEK_MODEL 换 deepseek-v4-pro。
const DEFAULT_MODEL = "deepseek-v4-flash";

export function getConfiguredModelName(): string {
  return process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
}

// 仅在生产（route 未注入 model）时调用；测试注入 MockLanguageModelV2，不触达此函数
export function getModel(): LanguageModel {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new AppError("请先在 API 配置中保存模型服务，或联系管理员配置站点默认服务");
  const deepseek = createOpenAICompatible({
    name: "deepseek",
    baseURL: normalizeModelBaseUrl(process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"),
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return deepseek(getConfiguredModelName());
}


/** Resolve on every operation so saved changes apply immediately, without sharing credentials. */
export async function resolveModelForUser(actorId: string): Promise<{ model: LanguageModel; modelName: string; source: "personal" | "site" }> {
  const config = await getPersonalModelConfig(actorId);
  if (!config) return { model: getModel(), modelName: getConfiguredModelName(), source: "site" };
  return { model: createOpenAICompatible({ name: "personal", baseURL: config.baseUrl, apiKey: config.apiKey })(config.model), modelName: config.model, source: "personal" };
}

export async function getModelForUser(actorId: string): Promise<LanguageModel> {
  return (await resolveModelForUser(actorId)).model;
}
