import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { AppError, NotFoundError } from "@/lib/errors";
import { ensureHome } from "@/lib/home";
import { requireHomePet } from "./home-pet-provider";
import { homePetSource } from "./home-pet-source";

export function desktopImageMime(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString())) return "image/gif";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  throw new AppError("桌面端只接收 PNG、WebP、GIF 或 JPEG 图片");
}
export async function readDesktopAsset(userId: string) {
  const home = await ensureHome(userId);
  if (!home.pet.petId) throw new NotFoundError("请先在家园选择桌宠");
  const pet = await requireHomePet(userId, home.pet.petId);
  let asset = await homePetSource.readAssetOwned?.(userId, pet.id);
  if (!asset && pet.appearance.src.startsWith("/pets/")) {
    try {
      const root = await realpath(path.join(process.cwd(), "public", "pets"));
      const filename = await realpath(path.join(process.cwd(), "public", decodeURIComponent(pet.appearance.src)));
      const relative = path.relative(root, filename);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new NotFoundError("桌宠资源不可读取");
      if ((await stat(filename)).size > 5 * 1024 * 1024) throw new AppError("桌宠图片超过 5 MiB");
      const bytes = await readFile(filename);
      asset = { bytes, mimeType: desktopImageMime(bytes) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new NotFoundError("桌宠资源暂不可用");
    }
  }
  if (!asset) throw new NotFoundError("桌宠模块尚未提供桌面资源读取接口");
  if (asset.bytes.length > 5 * 1024 * 1024) throw new AppError("桌宠图片超过 5 MiB");
  const mimeType = desktopImageMime(asset.bytes);
  if (asset.mimeType !== mimeType) throw new AppError("桌宠图片类型与内容不匹配");
  return { bytes: asset.bytes, mimeType, petId: pet.id };
}
