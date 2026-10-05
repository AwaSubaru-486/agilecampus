import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { authenticateBearer, mapExtensionError, unauthorized } from "@/lib/extension-auth";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";
import { extractSessionMemoryCandidate, preparedExtractionRequestSchema, SessionMemoryExtractionError } from "@/lib/session-memory/extract";

type Ctx = { params: Promise<{ projectId: string }> };
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request, ctx: Ctx) {
  const actorId = await authenticateBearer(req);
  if (!actorId) return unauthorized();
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "projectId 无效" }, { status: 400 });

  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "提炼输入超过 2 MiB 上限" }, { status: 413 });
    }
    let body: unknown;
    try { body = JSON.parse(raw) as unknown; }
    catch { return NextResponse.json({ error: "JSON 格式无效" }, { status: 400 }); }
    const input = preparedExtractionRequestSchema.parse(body);
    if (input.scope.projectId !== projectId) return NextResponse.json({ error: "项目范围与请求路径不一致" }, { status: 400 });

    const access = await getProjectForUser(actorId, projectId);
    if (!access) throw new ForbiddenError("无权访问该项目");
    const [task] = await db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.id, input.scope.taskId), eq(tasks.projectId, projectId)));
    if (!task) throw new NotFoundError("任务不存在或不属于该项目");

    let candidate;
    try {
      candidate = await extractSessionMemoryCandidate(input, { signal: req.signal });
    } catch (error) {
      if (error instanceof SessionMemoryExtractionError) {
        const status = error.code === "MODEL_UNAVAILABLE" ? 503 : 422;
        return NextResponse.json({ error: error.message, code: error.code }, { status, headers: { "Cache-Control": "private, no-store" } });
      }
      if (error instanceof z.ZodError) return NextResponse.json({ error: "提炼结果或输入格式无效" }, { status: 422 });
      // Never log the source text, prompt, model response, or provider error payload.
      console.error("POST session-memory extract failed", error instanceof Error ? error.name : "unknown error");
      return NextResponse.json({ error: "记忆提炼失败；本机记录与草稿未修改" }, { status: 503 });
    }
    return NextResponse.json({ candidate }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mapExtensionError(error, "POST /api/extension/v1/projects/[projectId]/session-memory/extract");
  }
}
