import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { listPetInteractions, sendPetInteraction } from "@/lib/pets/interactions";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ projectId: string }> };
async function handle(request: Request, context: Context, writing: boolean) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401, headers });
  try {
    const { projectId } = await context.params; z.uuid().parse(projectId);
    if (!writing) return Response.json({ events: await listPetInteractions(session.user.id, projectId) }, { headers });
    const url = new URL(request.url), origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== `${url.protocol}//${request.headers.get("host") ?? url.host}`)) throw new ForbiddenError("请求来源无效");
    const raw = await request.text(); if (raw.length > 4096) throw new AppError("请求过大");
    const body = z.object({ targetId: z.uuid(), kind: z.enum(["wave", "cheer", "coffee", "plane", "paper"]) }).parse(JSON.parse(raw));
    return Response.json({ event: await sendPetInteraction(session.user.id, projectId, body.targetId, body.kind) }, { headers });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error instanceof ForbiddenError ? 403 : 400, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "互动参数无效" }, { status: 400, headers });
    console.error("Pet interaction failed"); return Response.json({ error: "互动暂不可用" }, { status: 500, headers });
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, false);
export const POST = (request: Request, context: Context) => handle(request, context, true);
