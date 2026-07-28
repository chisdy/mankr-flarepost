import type { ProviderQuotaReading, SendProviderId } from '../adapters/send'
import {
  toQuota,
  utcDayStartMs,
  utcMonthStartMs,
  type ProviderStatus,
  type Quota,
} from './quota'

/**
 * Free-plan allowances per sending service. A `null` window means the provider imposes no
 * cap there, which is different from a cap of zero.
 */
export type SendProviderLimits = {
  emailsPerDay: number | null
  emailsPerMonth: number | null
}

export const SEND_PROVIDER_LIMITS: Record<SendProviderId, SendProviderLimits> = {
  resend: { emailsPerDay: 100, emailsPerMonth: 3_000 },
}

/** Long enough to cover the widest window (a calendar month) with room to spare. */
export const SEND_EVENT_RETENTION_MS = 60 * 24 * 60 * 60 * 1000

export type SendProviderUsage = {
  provider: SendProviderId
  status: ProviderStatus
  limits: SendProviderLimits
  daily: Quota | null
  monthly: Quota | null
  /** The provider's own tally, as of the last send it accepted. */
  reported: {
    dailyUsed: number | null
    monthlyUsed: number | null
    capturedAt: string
  } | null
  /** What this worker recorded itself. Always current, but blind to other senders. */
  observed: {
    daily: number
    monthly: number
  }
}

type QuotaReportRow = {
  daily_used: number | null
  monthly_used: number | null
  captured_at: number
}

/**
 * Records one accepted send. Returned as statements rather than executed, so callers can
 * batch this with their own bookkeeping in a single D1 round trip.
 */
export function recordSendStatements(
  db: D1Database,
  input: {
    provider: SendProviderId
    /** Providers count each recipient separately, so this is the recipient count. */
    units: number
    quota?: ProviderQuotaReading
  },
  now = Date.now(),
): D1PreparedStatement[] {
  const statements = [
    db
      .prepare('INSERT INTO send_usage_events (id, provider, units, sent_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), input.provider, Math.max(1, input.units), now),
    db
      .prepare('DELETE FROM send_usage_events WHERE sent_at < ?')
      .bind(now - SEND_EVENT_RETENTION_MS),
  ]

  // Only overwrite the stored report when the provider actually said something.
  if (input.quota) {
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_quota_reports (provider, daily_used, monthly_used, captured_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(provider) DO UPDATE SET
             daily_used = excluded.daily_used,
             monthly_used = excluded.monthly_used,
             captured_at = excluded.captured_at`,
        )
        .bind(input.provider, input.quota.dailyUsed, input.quota.monthlyUsed, now),
    )
  }

  return statements
}

async function sumUnitsSince(
  db: D1Database,
  provider: SendProviderId,
  since: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(units), 0) AS units FROM send_usage_events WHERE provider = ? AND sent_at >= ?')
    .bind(provider, since)
    .first<{ units: number }>()
  return row?.units ?? 0
}

/**
 * Combines both accounts of the same quota. The larger wins: the provider's figure covers
 * traffic this app never saw, while our own covers everything sent since that figure was
 * captured, and neither is a superset of the other.
 */
function reconcile(
  reported: number | null,
  observed: number,
  limit: number | null,
  window: 'day' | 'month',
): Quota | null {
  if (limit === null) return null
  return toQuota(Math.max(reported ?? 0, observed), limit, window)
}

export async function getSendProviderUsage(
  db: D1Database,
  provider: SendProviderId,
  configured: boolean,
  now: Date,
): Promise<SendProviderUsage> {
  const limits = SEND_PROVIDER_LIMITS[provider]

  if (!configured) {
    return {
      provider,
      status: 'not_configured',
      limits,
      daily: null,
      monthly: null,
      reported: null,
      observed: { daily: 0, monthly: 0 },
    }
  }

  const [report, observedDaily, observedMonthly] = await Promise.all([
    db
      .prepare(
        'SELECT daily_used, monthly_used, captured_at FROM provider_quota_reports WHERE provider = ?',
      )
      .bind(provider)
      .first<QuotaReportRow>(),
    sumUnitsSince(db, provider, utcDayStartMs(now)),
    sumUnitsSince(db, provider, utcMonthStartMs(now)),
  ])

  // A report from a previous window says nothing about the current one.
  const dailyReported =
    report && report.captured_at >= utcDayStartMs(now) ? report.daily_used : null
  const monthlyReported =
    report && report.captured_at >= utcMonthStartMs(now) ? report.monthly_used : null

  return {
    provider,
    status: 'ok',
    limits,
    daily: reconcile(dailyReported, observedDaily, limits.emailsPerDay, 'day'),
    monthly: reconcile(monthlyReported, observedMonthly, limits.emailsPerMonth, 'month'),
    reported: report
      ? {
          dailyUsed: report.daily_used,
          monthlyUsed: report.monthly_used,
          capturedAt: new Date(report.captured_at).toISOString(),
        }
      : null,
    observed: { daily: observedDaily, monthly: observedMonthly },
  }
}
