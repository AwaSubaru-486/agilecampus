import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized } from "./agent-auth";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";

export { authenticateBearer, unauthorized };

/** Parse an extension JSON body without treating malformed input as an empty object. */
export async function parseExtensionJson(
  req: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<unknown> {
  const raw = await req.text();
  if (!raw.trim()) {
    if (options.allowEmpty) return undefined;
    throw new AppError("请求体不能为空");
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("JSON 格式无效");
  }
}

export function mapExtensionError(e: unknown, tag: string) {
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: e.message || "没有权限执行此操作" }, { status: 403 });
  }
  if (e instanceof NotFoundError) {
    return NextResponse.json({ error: e.message || "请求的资源不存在" }, { status: 404 });
  }
  if (e instanceof ConflictError) {
    return NextResponse.json({ error: e.message || "资源状态或版本冲突" }, { status: 409 });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json({ error: "请求格式无效", details: e.issues }, { status: 400 });
  }
  if (e instanceof AppError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  console.error(tag, e);
  return NextResponse.json({ error: "服务器内部错误，请重试" }, { status: 500 });
}
