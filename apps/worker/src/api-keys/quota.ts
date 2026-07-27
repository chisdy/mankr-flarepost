export const WINDOW_MS = 60 * 60 * 1000
/** Only the trailing 24 windows are read, so anything older can go. */
export const USAGE_RETENTION_MS = 48 * 60 * 60 * 1000

export type QuotaCounts = {
  hourCount: number
  dayCount: number
}

export type QuotaLimits = {
  hourlyLimit: number
  dailyLimit: number
}

export type QuotaVerdict = { ok: true } | { ok: false; error: 'quota_exceeded'; scope: 'hour' | 'day' }

export function windowStartFor(now: number): number {
  return Math.floor(now / WINDOW_MS) * WINDOW_MS
}

/**
 * Soft limit: the check and the increment are not atomic, so concurrent
 * requests can overshoot slightly. Same trade-off as the web send path.
 */
export function evaluateQuota(counts: QuotaCounts, limits: QuotaLimits): QuotaVerdict {
  if (counts.hourCount >= limits.hourlyLimit) {
    return { ok: false, error: 'quota_exceeded', scope: 'hour' }
  }
  if (counts.dayCount >= limits.dailyLimit) {
    return { ok: false, error: 'quota_exceeded', scope: 'day' }
  }
  return { ok: true }
}

export async function readQuotaCounts(
  db: D1Database,
  apiKeyId: string,
  now = Date.now(),
): Promise<QuotaCounts> {
  const currentWindow = windowStartFor(now)
  const oldestWindow = currentWindow - 23 * WINDOW_MS
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN window_start = ? THEN count ELSE 0 END) AS hour_count,
         SUM(count) AS day_count
       FROM api_key_usage
       WHERE api_key_id = ? AND window_start >= ?`,
    )
    .bind(currentWindow, apiKeyId, oldestWindow)
    .first<{ hour_count: number | null; day_count: number | null }>()

  return {
    hourCount: row?.hour_count ?? 0,
    dayCount: row?.day_count ?? 0,
  }
}

/** Counts come back with the verdict: callers use them to decide on pruning. */
export async function checkQuota(
  db: D1Database,
  apiKey: { id: string; hourlyLimit: number; dailyLimit: number },
  now = Date.now(),
): Promise<{ verdict: QuotaVerdict; counts: QuotaCounts }> {
  const counts = await readQuotaCounts(db, apiKey.id, now)
  const verdict = evaluateQuota(counts, {
    hourlyLimit: apiKey.hourlyLimit,
    dailyLimit: apiKey.dailyLimit,
  })
  return { verdict, counts }
}

/** Prepared so the caller can batch it with the send-log insert. */
export function incrementQuotaStatement(
  db: D1Database,
  apiKeyId: string,
  now = Date.now(),
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO api_key_usage (api_key_id, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT (api_key_id, window_start)
       DO UPDATE SET count = count + 1`,
    )
    .bind(apiKeyId, windowStartFor(now))
}

export function pruneQuotaStatement(db: D1Database, now = Date.now()): D1PreparedStatement {
  return db
    .prepare('DELETE FROM api_key_usage WHERE window_start < ?')
    .bind(windowStartFor(now) - USAGE_RETENTION_MS)
}
