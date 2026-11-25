import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { webPetRuntime } from "./web-pet-runtime";

export const webPetConfigSchema = z.object({
  preset: z.enum(["puppy", "pacman", "nailong", "mentor", "custom"]),
  name: z.string().trim().min(1).max(40), customImageUrl: z.string().max(3 * 1024 * 1024).default(""),
  soundEnabled: z.boolean().default(true), webPetVisible: z.boolean().optional(),
});
export const webPetId = (ownerId: string) => `web:${ownerId}`;
export async function readWebPetConfig(ownerId: string) {
  try {
    const filename = path.join(webPetRuntime(ownerId), "desk-pet-config.json");
    if ((await stat(filename)).size > 3 * 1024 * 1024) throw new Error("config too large");
    return webPetConfigSchema.parse({ preset: "puppy", name: "线条小狗", ...JSON.parse(await readFile(filename, "utf8")) });
  } catch { return webPetConfigSchema.parse({ preset: "puppy", name: "线条小狗" }); }
}
export function webPetAssetKey(config: Awaited<ReturnType<typeof readWebPetConfig>>) {
  return createHash("sha256").update(config.preset + "\n" + config.customImageUrl).digest("hex").slice(0, 24);
}
export async function readWebPetAsset(ownerId: string, suppliedConfig?: Awaited<ReturnType<typeof readWebPetConfig>>, greeting = false): Promise<{ bytes: Uint8Array; mimeType: string } | { redirect: string } | null> {
  const config = suppliedConfig ?? await readWebPetConfig(ownerId);
  const source = config.preset === "custom" ? config.customImageUrl.trim().replace(/^["']|["']$/g, "") : `/desk-pet/frames/${config.preset}_${greeting ? 3 : 0}.png`;
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source); if (url.username || url.password) return null;
    return { redirect: url.href }; // Browser redirect only; never fetch user URLs on the server.
  }
  const data = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(source);
  if (data) {
    const bytes = Buffer.from(data[2], "base64");
    return bytes.length <= 2 * 1024 * 1024 ? { bytes, mimeType: `image/${data[1]}` } : null;
  }
  if (!source || source.startsWith("//") || /[\\:#?%]/.test(source) || source.split("/").includes("..")) return null;
  try {
    const root = await realpath(path.join(process.cwd(), "public"));
    const filename = await realpath(path.resolve(root, source.replace(/^\//, "")));
    const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
    const mimeType = mime[path.extname(filename).toLowerCase()];
    if (!filename.startsWith(root + path.sep) || !mimeType || (await stat(filename)).size > 2 * 1024 * 1024) return null;
    return { bytes: await readFile(filename), mimeType };
  } catch { return null; }
}
export async function saveWebPetConfig(ownerId: string, patch: unknown) {
  const config = webPetConfigSchema.parse({ ...await readWebPetConfig(ownerId), ...webPetConfigSchema.partial().parse(patch) });
  if (config.preset === "custom" && !await readWebPetAsset(ownerId, config)) throw new Error("请选择有效的 PNG、JPEG、WebP 或 GIF 图片，最大 2 MiB");
  const root = webPetRuntime(ownerId); await mkdir(root, { recursive: true });
  const temporary = path.join(root, `config-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(config), "utf8");
  await rename(temporary, path.join(root, "desk-pet-config.json"));
  return config;
}
