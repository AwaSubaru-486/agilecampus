import { NextResponse } from "next/server";
import { webPetActor, webPetRuntime } from "@/lib/pets/web-pet-security";
import { auth } from "@/lib/auth";
import { dismissTaskNotification } from "@/lib/task-notifications";
import { PayloadTooLargeError, readTextWithLimit } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import path from "path";
import fs from "fs";


export async function POST(req: Request) {
  const actor = await webPetActor(req);
  if (actor instanceof Response) return actor;
  const limited = rateLimit(`pet:reply:${actor}`, 60, 60 * 1000);
  if (!limited.ok) return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });

  let raw: string;
  try {
    raw = await readTextWithLimit(req, 32768);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) return NextResponse.json({ error: e.message }, { status: 413 });
    throw e;
  }
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  const { notificationId, text } = body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "回复内容不能为空" }, { status: 400 });
  }

  const runtimeDir = webPetRuntime(actor);
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }

  // 1. 若回复的是网站通知，则进行确认并关闭通知
  try {
    const session = await auth();
    if (session?.user?.id && notificationId) {
      await dismissTaskNotification(session.user.id, notificationId);
    }
  } catch (err) {
    console.warn("[desktop-pet/reply] dismissTaskNotification 警告:", err);
  }

  // 2. 将回复持久化到 replies.json
  const repliesFile = path.resolve(runtimeDir, "desk-pet-replies.json");
  let replies: Array<{ id: string; text: string; time: string; notificationId?: string }> = [];
  if (fs.existsSync(repliesFile)) {
    try {
      replies = JSON.parse(fs.readFileSync(repliesFile, "utf8"));
    } catch {}
  }

  const newReply = {
    id: "reply-" + Date.now(),
    text: text.trim(),
    notificationId,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
  replies.push(newReply);
  fs.writeFileSync(repliesFile, JSON.stringify(replies.slice(-50), null, 2), "utf8");

  return NextResponse.json({
    ok: true,
    message: "回复已成功送达网站！",
    reply: newReply,
  });
}
