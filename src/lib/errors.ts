// 可预期业务错误：message 可直接展示给用户
export class AppError extends Error {}

export class ForbiddenError extends AppError {
  constructor(message = "没有权限执行此操作") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "请求的资源不存在") {
    super(message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "资源状态或版本冲突") {
    super(message);
  }
}

// postgres 唯一键冲突。drizzle 会把驱动错误包装为 DrizzleQueryError（code 在 cause 上），故两处都查
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? ((e as { cause?: { code?: string } }).cause?.code);
  return code === "23505";
}
