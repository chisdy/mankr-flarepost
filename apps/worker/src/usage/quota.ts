/** Shared quota primitives, kept apart from the readers so either can import them. */

export type QuotaWindow = 'day' | 'month' | 'total'
export type ProviderStatus = 'ok' | 'not_configured' | 'error'

export type Quota = {
  used: number
  limit: number
  remaining: number
  window: QuotaWindow
}

export function toQuota(used: number, limit: number, window: QuotaWindow): Quota {
  const safeUsed = Math.max(0, Math.round(used))
  return { used: safeUsed, limit, remaining: Math.max(0, limit - safeUsed), window }
}

export function utcDayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00Z`
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Quota windows are UTC everywhere, so a local timezone never shifts the reset moment. */
export function utcDayStartMs(now: Date): number {
  return Date.parse(utcDayStart(now))
}

export function utcMonthStartMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
}
