import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authenticateBearer } from "@/lib/extension-auth";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { claimMemoryContinuation, createMemoryContinuation, getMemoryContinuation, reportMemoryContinuation } from "@/lib/task-memory-continuation";

type Context = { params: Promise<{ projectId: string; taskId: string }> };
const scope = z.object({ projectId: z.uuid(), taskId: z.uuid() });
const headers = { "Cache-Control": "private, no-store" };
const create = z.object({ id: z.uuid(), versionId: z.uuid() }).strict();
const patch = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("claim"), id: z.uuid(), versionId: z.uuid(), claimId: z.uuid() }).strict(),
  z.object({ operation: z.literal("report"), id: z.uuid(), claimId: z.uuid(), sequence: z.number().int().positive(),
    state: z.enum(["checking", "awaiting_confirmation", "launching", "running", "finished", "failed", "cancelled", "unknown"]),
    attemptId: z.uuid().optional(), sessionConfirmed: z.boolean().optional(),
  }).strict(),
]);
async function readBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > 4096) throw new AppError("请求过大");
  try { return JSON.parse(text); } catch { throw new AppError("请求 JSON 无效"); }
}
async function handle(request: Request, context: Context, method: "GET" | "POST" | "PATCH") {
  try {
    const bearer = request.headers.has("authorization");
    const actorId = bearer ? await authenticateBearer(request) : (await auth())?.user?.id;
    if (!actorId) return NextResponse.json({ error: "请先登录或连接插件" }, { status: 401, headers });
    const { projectId, taskId } = scope.parse(await context.params);
    if (method !== "GET" && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) throw new ForbiddenError("来源不匹配");
    if (method === "GET") {
      const id = new URL(request.url).searchParams.get("id");
      return NextResponse.json({ continuation: await getMemoryContinuation(actorId, projectId, taskId, id ? z.uuid().parse(id) : undefined) }, { headers });
    }
    if (method === "POST") {
      const input = create.parse(await readBody(request));
      return NextResponse.json(await createMemoryContinuation(actorId, projectId, taskId, input.id, input.versionId), { status: 201, headers });
    }
    if (!bearer) throw new ForbiddenError("接续回执须由已连接的插件提交");
    const input = patch.parse(await readBody(request));
    const result = input.operation === "claim"
      ? await claimMemoryContinuation(actorId, projectId, taskId, input.id, input.versionId, input.claimId)
      : await reportMemoryContinuation(actorId, projectId, taskId, input.id, input.claimId, input.sequence, input);
    return NextResponse.json(result, { headers });
  } catch (error) {
    const status = error instanceof ForbiddenError ? 403 : error instanceof NotFoundError ? 404 : error instanceof ConflictError ? 409 : error instanceof AppError || error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: error instanceof z.ZodError ? "接续参数无效" : error instanceof AppError ? error.message : "接续服务暂不可用，请重试" }, { status, headers });
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, "GET");
export const POST = (request: Request, context: Context) => handle(request, context, "POST");
export const PATCH = (request: Request, context: Context) => handle(request, context, "PATCH");
