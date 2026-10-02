import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized } from "./agent-auth";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";

export { authenticateBearer, unauthorized };

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
