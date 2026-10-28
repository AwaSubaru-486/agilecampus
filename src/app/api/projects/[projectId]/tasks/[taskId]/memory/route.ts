import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authenticateBearer } from "@/lib/extension-auth";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getTaskMemoryVersion, listTaskMemoryVersions, saveTaskMemory } from "@/lib/task-memory";

type Context = { params: Promise<{ projectId: string; taskId: string }> };
const scopeSchema = z.object({ projectId: z.uuid(), taskId: z.uuid() });
const headers = { "Cache-Control": "private, no-store" };
async function actor(request: Request) {
  // A supplied Bearer token is never silently downgraded to a browser session.
  if (request.headers.has("authorization")) return authenticateBearer(request);
  return (await auth())?.user?.id ?? null;
}
function fail(error: unknown) {
  const status = error instanceof ForbiddenError ? 403 : error instanceof NotFoundError ? 404 : error instanceof ConflictError ? 409 : 400;
  if (error instanceof AppError || error instanceof z.ZodError) return NextResponse.json({ error: error instanceof z.ZodError ? "任务参数无效" : error.message }, { status, headers });
  console.error("[task-memory] operation failed");
  return NextResponse.json({ error: "记忆服务暂不可用，请重试" }, { status: 500, headers });
}
export async function GET(request: Request, context: Context) {
  try {
    const actorId = await actor(request);
    if (!actorId) return NextResponse.json({ error: "请先登录或连接插件" }, { status: 401, headers });
    const { projectId, taskId } = scopeSchema.parse(await context.params);
    const versionId = new URL(request.url).searchParams.get("version");
    if (versionId) {
      const version = await getTaskMemoryVersion(actorId, projectId, taskId, z.uuid().parse(versionId));
      return NextResponse.json(version, { headers });
    }
    return NextResponse.json({ versions: await listTaskMemoryVersions(actorId, projectId, taskId) }, { headers });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const actorId = await actor(request);
    if (!actorId) return NextResponse.json({ error: "请先登录或连接插件" }, { status: 401, headers });
    const { projectId, taskId } = scopeSchema.parse(await context.params);
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) throw new ForbiddenError("来源不匹配");
    if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024) throw new AppError("文件超过 2 MiB");
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw new AppError("文件超过 2 MiB");
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new AppError("无法解析记忆 JSON"); }
    const saved = await saveTaskMemory(actorId, projectId, taskId, value, new URL(request.url).origin);
    return NextResponse.json({ id: saved.id }, { status: 201, headers });
  } catch (error) { return fail(error); }
}
