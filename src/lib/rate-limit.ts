/**
 * 进程内固定窗口限流与并发控制。
 *
 * 本项目的部署目标是单实例（docker-compose 或本机运行），因此用进程内 Map
 * 足够挡住密码猜测、批量注册和模型费用滥用。多实例部署时每个实例各自计数，
 * 需要换成 Redis/数据库等共享存储；这一点在 README 中说明，不假装是分布式限流。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const active = new Map<string, number>();

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const MAX_BUCKETS = 5000;

function prune(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // 极端情况下仍然过多，就丢弃最早过期的键，避免内存无限增长。
  if (buckets.size >= MAX_BUCKETS) {
    const overflow = buckets.size - MAX_BUCKETS + 1;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= overflow) break;
    }
  }
}

/** 固定窗口计数：同一 key 在 windowMs 内最多 limit 次。 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  prune(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, limit, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return {
      ok: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { ok: true, limit, remaining: Math.max(0, limit - existing.count), retryAfterSeconds: 0 };
}

/** 成功后清除某个 key，例如登录成功后不再累计失败次数。 */
export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/** 仅供测试或多租户切换时清空。 */
export function resetAllRateLimits() {
  buckets.clear();
  active.clear();
}

/** 并发闸门：同一 key 同时最多 max 个在途请求。 */
export function tryAcquireSlot(key: string, max: number): boolean {
  const current = active.get(key) ?? 0;
  if (current >= max) return false;
  active.set(key, current + 1);
  return true;
}

export function releaseSlot(key: string) {
  const current = active.get(key) ?? 0;
  if (current <= 1) active.delete(key);
  else active.set(key, current - 1);
}

export function activeSlots(key: string) {
  return active.get(key) ?? 0;
}
