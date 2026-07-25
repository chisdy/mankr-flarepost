export const SEND_LIMIT_PER_HOUR = 30
const WINDOW_MS = 60 * 60 * 1000

type Bucket = { count: number; windowStart: number }

/** Approximate per-isolate rate limit (V1 soft limit). */
const buckets = new Map<string, Bucket>()

export function resetRateLimits(): void {
  buckets.clear()
}

/** Peek whether a send is allowed without consuming quota. */
export function checkRateLimit(
  key: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: 'rate_limited' } {
  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    return { ok: true }
  }
  if (existing.count >= SEND_LIMIT_PER_HOUR) {
    return { ok: false, error: 'rate_limited' }
  }
  return { ok: true }
}

/** Record a successful send against the soft quota. Call only after provider accept. */
export function incrementRateLimit(key: string, now = Date.now()): void {
  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now })
    return
  }
  existing.count += 1
}
