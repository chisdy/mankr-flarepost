export const SEND_LIMIT_PER_HOUR = 30
const WINDOW_MS = 60 * 60 * 1000

type Bucket = { count: number; windowStart: number }

/** Approximate per-isolate rate limit (V1 soft limit). */
const buckets = new Map<string, Bucket>()

export function resetRateLimits(): void {
  buckets.clear()
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: 'rate_limited' } {
  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now })
    return { ok: true }
  }
  if (existing.count >= SEND_LIMIT_PER_HOUR) {
    return { ok: false, error: 'rate_limited' }
  }
  existing.count += 1
  return { ok: true }
}
