import { AppError } from "./errors";

/** 请求体超过上限时抛出，路由层应返回 413。 */
export class PayloadTooLargeError extends AppError {}

const decoder = new TextDecoder();

function formatLimit(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} 字节`;
}

/**
 * 按字节上限读取请求体。先看 Content-Length 快速拒绝，再流式累计，
 * 避免超大请求先被完整读进内存。
 */
export async function readTextWithLimit(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PayloadTooLargeError(`请求过大，最多 ${formatLimit(maxBytes)}`);
  }
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError(`请求过大，最多 ${formatLimit(maxBytes)}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (!chunks.length) return "";
  if (chunks.length === 1) return decoder.decode(chunks[0]);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(merged);
}

export async function readJsonWithLimit(
  req: Request,
  options: { maxBytes: number; allowEmpty?: boolean },
): Promise<unknown> {
  const raw = await readTextWithLimit(req, options.maxBytes);
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

/** 取客户端 IP。仅在部署层可信地覆盖 x-forwarded-for 时才有防伪造效果。 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  return forwarded || real || "unknown";
}

export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers);
}

export function retryAfterMessage(result: { retryAfterSeconds: number }) {
  return `操作过于频繁，请 ${result.retryAfterSeconds} 秒后再试`;
}
