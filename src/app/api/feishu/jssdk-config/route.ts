import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getJsapiTicket, buildJsapiSignature } from "@/lib/feishu";
import { clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

/**
 * 允许签名的来源。登录页在未登录时就会调用这个接口，所以不能要求登录；
 * 改为只给本站页面签名，避免被第三方页面当成免费签名服务。
 */
function allowedOrigins(req: Request) {
  const origins = new Set<string>();

  for (const value of [process.env.AGILECAMPUS_URL, process.env.FEISHU_JSSDK_ALLOWED_ORIGINS]) {
    for (const item of (value ?? "").split(",")) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      try {
        origins.add(new URL(trimmed).origin);
      } catch {
        // 配置项写错时忽略。
      }
    }
  }

  // 生产环境只要配置了对外地址，就只认显式来源；Host 和 x-forwarded-host
  // 都来自请求方，不能作为可信任的签名依据。
  if (process.env.NODE_ENV === "production" && origins.size > 0) return origins;

  const requestUrl = new URL(req.url);
  origins.add(requestUrl.origin);
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) origins.add(`${forwardedProto || requestUrl.protocol.replace(":", "")}://${forwardedHost}`);
  return origins;
}

// 前端 JSSDK 鉴权签名签发。入参 url=当前页面完整 URL（不含 #fragment）。
export async function GET(req: Request) {
  const limited = rateLimit(`feishu-jssdk:ip:${clientIp(req)}`, 60, 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "缺 url" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "url 格式无效" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    return NextResponse.json({ error: "url 格式无效" }, { status: 400 });
  }
  if (!allowedOrigins(req).has(target.origin)) {
    return NextResponse.json({ error: "只允许为本站页面签名" }, { status: 403 });
  }

  try {
    const ticket = await getJsapiTicket();
    const nonceStr = randomBytes(8).toString("hex");
    const timestamp = Date.now();
    const signature = buildJsapiSignature({ ticket, nonceStr, timestamp, url: raw });
    return NextResponse.json({
      appId: process.env.FEISHU_APP_ID ?? "",
      timestamp,
      nonceStr,
      signature,
    });
  } catch (e) {
    console.error("[feishu jssdk-config]", e);
    return NextResponse.json({ error: "签名失败" }, { status: 500 });
  }
}
