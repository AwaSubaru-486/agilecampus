import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ConflictError, ForbiddenError } from "@/lib/errors";
import { moveHomePet, saveHome } from "@/lib/home";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401 });
  // Require a same-origin browser mutation in addition to session authentication.
  const origin = request.headers.get("origin");
  // Next's internal URL can use localhost while the browser uses 127.0.0.1.
  // Match the actual request authority rather than that internal hostname.
  const url = new URL(request.url);
  const authority = request.headers.get("host") ?? url.host;
  if (origin && origin !== `${url.protocol}//${authority}`) return Response.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const body = await request.json();
    if (body.operation === "save") return Response.json({ home: await saveHome(session.user.id, body.settings) });
    if (body.operation === "move") {
      const destination = z.object({ teamId: z.uuid().nullable() }).parse(body);
      return Response.json({ home: await moveHomePet(session.user.id, destination.teamId) });
    }
    return Response.json({ error: "未知家园操作" }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "家园设置无效" }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: "请求格式无效" }, { status: 400 });
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error instanceof ForbiddenError ? 403 : error instanceof ConflictError ? 409 : 400 });
    console.error("Home operation failed", error);
    return Response.json({ error: "家园暂时无法保存，请稍后重试" }, { status: 500 });
  }
}
