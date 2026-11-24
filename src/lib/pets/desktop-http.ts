import { z } from "zod";
import { AppError, ForbiddenError } from "@/lib/errors";
export const desktopHeaders = { "Cache-Control": "private, no-store" };
export function desktopFailure(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error instanceof ForbiddenError ? 401 : 400, headers: desktopHeaders });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "桌面请求格式无效" }, { status: 400, headers: desktopHeaders });
  console.error("Desktop companion request failed");
  return Response.json({ error: "桌面陪伴服务暂不可用" }, { status: 500, headers: desktopHeaders });
}
export function desktopSameOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  return !origin || origin === `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}
export async function desktopJson(request: Request) {
  const raw = await request.text();
  if (raw.length > 2048) throw new AppError("桌面请求过长");
  return JSON.parse(raw);
}
