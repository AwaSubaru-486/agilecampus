import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { AppError, ForbiddenError } from "@/lib/errors";
import { MAX_CHAT_INPUT_CHARS, ChatTimeoutError, ChatCanceledError } from "@/lib/agent/chat-context";
import { PayloadTooLargeError, readJsonWithLimit, retryAfterMessage } from "@/lib/http";
import { rateLimit, releaseSlot, tryAcquireSlot } from "@/lib/rate-limit";

const MAX_CHAT_BODY_BYTES = 64 * 1024;
const CHAT_RATE_LIMIT = 30;
const CHAT_RATE_WINDOW_MS = 60 * 1000;
const CHAT_CONCURRENCY = 2;

const schema = z.object({
  projectId: z.uuid(),
  conversationId: z.uuid().optional(),
  contextPackId: z.uuid().optional(),
  taskMemoryVersionId: z.uuid().optional(),
  userText: z.string().trim().min(1, "请输入内容").max(MAX_CHAT_INPUT_CHARS, "消息过长，请缩短后再发送"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const actorId = session.user.id;
  const slotKey = `chat:${actorId}`;
  const limited = rateLimit(slotKey, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: retryAfterMessage(limited) },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }
  if (!tryAcquireSlot(slotKey, CHAT_CONCURRENCY)) {
    return NextResponse.json({ error: "已有对话正在进行，请等待当前回复结束" }, { status: 429 });
  }

  try {
    let body: unknown;
    try {
      body = await readJsonWithLimit(req, { maxBytes: MAX_CHAT_BODY_BYTES });
    } catch (e) {
      if (e instanceof PayloadTooLargeError) return NextResponse.json({ error: e.message }, { status: 413 });
      if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    try {
      const result = await runAgentTurn({
        actorId,
        projectId: parsed.data.projectId,
        conversationId: parsed.data.conversationId,
        contextPackId: parsed.data.contextPackId,
        taskMemoryVersionId: parsed.data.taskMemoryVersionId,
        userText: parsed.data.userText,
        abortSignal: req.signal,
      });
      return NextResponse.json({
        conversationId: result.conversationId,
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
        text: result.text,
        toolTrace: result.toolTrace,
        drafts: result.drafts,
        taskMemoryVersionId: result.taskMemoryVersionId,
      });
    } catch (e) {
      if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
      if (e instanceof ChatTimeoutError) return NextResponse.json({ error: e.message }, { status: 504 });
      if (e instanceof ChatCanceledError) return NextResponse.json({ error: e.message }, { status: 408 });
      if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
      // 未预期错误（含 DeepSeek 超时/失败）：服务端留痕，对客户端只呈通用消息，不暴露内部细节
      console.error("[/api/chat] runAgentTurn 失败:", e);
      return NextResponse.json({ error: "对话失败，请重试" }, { status: 500 });
    }
  } finally {
    releaseSlot(slotKey);
  }
}
