import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let targetPath = searchParams.get("path") || "";

    if (!targetPath) {
      return NextResponse.json({ error: "缺少 path 参数" }, { status: 400 });
    }

    // 清理首尾双引号或单引号
    targetPath = targetPath.trim().replace(/^["']|["']$/g, "");

    // 去除 file:/// 前缀
    if (targetPath.startsWith("file:///")) {
      targetPath = decodeURIComponent(targetPath.replace(/^file:\/\/\/?/, ""));
      // 在 Windows 下如果是 C:/...，确保盘符正确
      if (/^[a-zA-Z]:/.test(targetPath)) {
        targetPath = path.normalize(targetPath);
      }
    }

    // 检查文件是否存在
    if (!fs.existsSync(targetPath)) {
      return NextResponse.json(
        { error: "本地文件不存在，请检查路径是否正确", path: targetPath },
        { status: 404 }
      );
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "目标不是有效文件" }, { status: 400 });
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    const buffer = fs.readFileSync(targetPath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "读取文件失败", detail: message }, { status: 500 });
  }
}
