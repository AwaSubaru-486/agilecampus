import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized } from "./agent-auth";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { PayloadTooLargeError, readJsonWithLimit } from "./http";

export { authenticateBearer, unauthorized };

export const MAX_EXTENSION_JSON_BYTES = 1024 * 1024;

/** Parse an extension JSON body with a hard byte limit. */
export async function parseExtensionJson(
  req: Request,
  options: { allowEmpty?: boolean; maxBytes?: number } = {},
): Promise<unknown> {
  return readJsonWithLimit(req, {
    maxBytes: options.maxBytes ?? MAX_EXTENSION_JSON_BYTES,
    allowEmpty: options.allowEmpty,
  });
}

export function mapExtensionError(e: unknown, tag: string) {
  if (e instanceof PayloadTooLargeError) {
    return NextResponse.json({ error: e.message }, { status: 413 });
  }
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
