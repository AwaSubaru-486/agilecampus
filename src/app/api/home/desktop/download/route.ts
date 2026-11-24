import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401 });
  const filename = path.join(process.cwd(), ".local", "desktop-release", "AgileCampusPet-Windows-x64.zip");
  try {
    const file = await stat(filename);
    return new Response(Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": "application/zip", "Content-Length": String(file.size),
      "Content-Disposition": 'attachment; filename="AgileCampusPet-Windows-x64.zip"', "Cache-Control": "private, no-store",
    } });
  } catch { return Response.json({ error: "当前服务暂未提供 Windows 客户端，请联系团队管理员" }, { status: 404 }); }
}
