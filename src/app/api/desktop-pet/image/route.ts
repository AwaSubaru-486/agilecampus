import fs from "node:fs/promises";
import path from "node:path";
import { webPetActor } from "@/lib/pets/web-pet-security";

// Only repository public images are readable. Never accept server-local absolute paths.
export async function GET(request: Request) {
  const actor = await webPetActor();
  if (actor instanceof Response) return actor;
  const name = new URL(request.url).searchParams.get("path") ?? "";
  if (!name || path.isAbsolute(name) || name.includes("\\") || name.includes(":"))
    return Response.json({ error: "仅支持 public 目录内的图片相对路径" }, { status: 400 });
  try {
    const root = await fs.realpath(path.join(process.cwd(), "public"));
    const target = await fs.realpath(path.resolve(root, name));
    if (!target.startsWith(root + path.sep)) return Response.json({ error: "图片路径不可访问" }, { status: 403 });
    const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
    const type = mime[path.extname(target).toLowerCase()];
    const stat = await fs.stat(target);
    if (!type || !stat.isFile() || stat.size > 10 * 1024 * 1024)
      return Response.json({ error: "不支持的图片文件" }, { status: 400 });
    return new Response(new Uint8Array(await fs.readFile(target)), { headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "图片不存在" }, { status: 404 });
  }
}
