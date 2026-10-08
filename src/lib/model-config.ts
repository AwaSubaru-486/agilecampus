import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userModelConfigs } from "@/db/schema";
import { AppError } from "./errors";

export const modelConfigSchema = z.object({
  baseUrl: z.url().max(500).refine(value => {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, "填写 HTTP 或 HTTPS API 地址，不要包含账号、查询参数或密钥"),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().max(4096),
});
function encryptionKey() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AppError("服务器未配置密钥加密凭据，请联系管理员");
  return createHash("sha256").update(`agilecampus:model-config:${secret}`).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
function decrypt(value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
}
export async function getModelConfigStatus(actorId: string) {
  const [row] = await db.select({ baseUrl: userModelConfigs.baseUrl, model: userModelConfigs.model }).from(userModelConfigs).where(eq(userModelConfigs.userId, actorId));
  return { baseUrl: row?.baseUrl ?? "https://api.deepseek.com", model: row?.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash", personal: Boolean(row), ready: Boolean(row || process.env.DEEPSEEK_API_KEY) };
}
export async function saveModelConfig(actorId: string, input: unknown) {
  const config = modelConfigSchema.parse(input);
  const [existing] = await db.select().from(userModelConfigs).where(eq(userModelConfigs.userId, actorId));
  if (!config.apiKey && !existing) throw new AppError("首次配置请填写 API Key");
  const values = { baseUrl: config.baseUrl.replace(/\/$/, ""), model: config.model, encryptedKey: config.apiKey ? encrypt(config.apiKey) : existing!.encryptedKey, updatedAt: new Date() };
  await db.insert(userModelConfigs).values({ userId: actorId, ...values }).onConflictDoUpdate({ target: userModelConfigs.userId, set: values });
}
export async function getPersonalModelConfig(actorId: string) {
  const [row] = await db.select().from(userModelConfigs).where(eq(userModelConfigs.userId, actorId));
  return row ? { baseUrl: row.baseUrl, model: row.model, apiKey: decrypt(row.encryptedKey) } : null;
}
