import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { dismissTaskNotification, listTaskNotifications } from "@/lib/task-notifications";
import { AppError } from "@/lib/errors";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json(await listTaskNotifications(session.user.id), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  // Session-authenticated writes are same-origin; this route cannot acknowledge another user's inbox.
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    // Next may construct request.url with localhost even when the browser used 127.0.0.1.
    // Compare the browser's origin against the actual Host header instead of that internal URL.
    const originUrl = new URL(origin ?? "");
    sameOrigin = ["http:", "https:"].includes(originUrl.protocol) && originUrl.host === request.headers.get("host");
  } catch { /* Missing or malformed Origin cannot acknowledge an alert. */ }
  if (!sameOrigin) return NextResponse.json({ error: "请求来源不正确" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = z.object({ id: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "通知编号不正确" }, { status: 400 });
  try {
    await dismissTaskNotification(session.user.id, parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
