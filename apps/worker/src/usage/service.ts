import type { Env } from '../env'

/**
 * Free-plan ceilings. A Paid account's real limits are higher, so the UI must
 * label these as free-tier allowances rather than absolute remaining capacity.
 */
export const RESEND_FREE_DAILY_EMAILS = 100
export const RESEND_FREE_MONTHLY_EMAILS = 3_000
export const WORKERS_FREE_REQUESTS_PER_DAY = 100_000
export const D1_FREE_ROWS_READ_PER_DAY = 5_000_000
export const D1_FREE_ROWS_WRITTEN_PER_DAY = 100_000
export const D1_FREE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024

/** Per-isolate best-effort cache; a cold start simply re-fetches. */
export const USAGE_CACHE_TTL_MS = 60_000

const RESEND_ENDPOINT = 'https://api.resend.com/emails?limit=1'
const CLOUDFLARE_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'

export type QuotaWindow = 'day' | 'month' | 'total'
export type ProviderStatus = 'ok' | 'not_configured' | 'error'

export type Quota = {
  used: number
  limit: number
  remaining: number
  window: QuotaWindow
}

export type ResendUsage = {
  status: ProviderStatus
  daily: Quota | null
  monthly: Quota | null
}

/**
 * Why a Cloudflare read failed. `unauthorized` almost always means the token is missing the
 * `Account Analytics → Read` permission, which is worth telling the user outright.
 */
export type CloudflareErrorReason = 'unauthorized' | 'query_failed' | 'unreachable'

export type CloudflareUsage = {
  status: ProviderStatus
  reason: CloudflareErrorReason | null
  workersRequests: Quota | null
  d1RowsRead: Quota | null
  d1RowsWritten: Quota | null
  d1StorageBytes: Quota | null
}

export type FreeTierLimits = {
  resendEmailsPerDay: number
  resendEmailsPerMonth: number
  workersRequestsPerDay: number
  d1RowsReadPerDay: number
  d1RowsWrittenPerDay: number
  d1StorageBytes: number
}

/** Sent to the client so the UI never hardcodes a second copy of these numbers. */
export const FREE_TIER_LIMITS: FreeTierLimits = {
  resendEmailsPerDay: RESEND_FREE_DAILY_EMAILS,
  resendEmailsPerMonth: RESEND_FREE_MONTHLY_EMAILS,
  workersRequestsPerDay: WORKERS_FREE_REQUESTS_PER_DAY,
  d1RowsReadPerDay: D1_FREE_ROWS_READ_PER_DAY,
  d1RowsWrittenPerDay: D1_FREE_ROWS_WRITTEN_PER_DAY,
  d1StorageBytes: D1_FREE_STORAGE_BYTES,
}

export type UsageSnapshot = {
  fetchedAt: string
  freeTier: FreeTierLimits
  resend: ResendUsage
  cloudflare: CloudflareUsage
}

export function toQuota(used: number, limit: number, window: QuotaWindow): Quota {
  const safeUsed = Math.max(0, Math.round(used))
  return { used: safeUsed, limit, remaining: Math.max(0, limit - safeUsed), window }
}

/** A missing header means "unknown", never zero. */
export function parseQuotaHeader(raw: string | null): number | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export function utcDayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00Z`
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

const RESEND_UNCONFIGURED: ResendUsage = {
  status: 'not_configured',
  daily: null,
  monthly: null,
}

const CLOUDFLARE_UNCONFIGURED: CloudflareUsage = {
  status: 'not_configured',
  reason: null,
  workersRequests: null,
  d1RowsRead: null,
  d1RowsWritten: null,
  d1StorageBytes: null,
}

export async function fetchResendUsage(env: Pick<Env, 'RESEND_API_KEY'>): Promise<ResendUsage> {
  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) return RESEND_UNCONFIGURED

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    // 429 still carries the quota headers, which is exactly what we want to read.
    if (!res.ok && res.status !== 429) {
      return { status: 'error', daily: null, monthly: null }
    }

    // Only free plans get the daily header; Paid accounts omit it.
    const daily = parseQuotaHeader(res.headers.get('x-resend-daily-quota'))
    const monthly = parseQuotaHeader(res.headers.get('x-resend-monthly-quota'))

    return {
      status: 'ok',
      daily: daily === null ? null : toQuota(daily, RESEND_FREE_DAILY_EMAILS, 'day'),
      monthly: monthly === null ? null : toQuota(monthly, RESEND_FREE_MONTHLY_EMAILS, 'month'),
    }
  } catch {
    return { status: 'error', daily: null, monthly: null }
  }
}

const WORKERS_QUERY = `query WorkersUsage($accountTag: string!, $start: Time, $end: Time) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
        sum {
          requests
        }
      }
    }
  }
}`

const D1_QUERY = `query D1Usage($accountTag: string!, $start: Date, $end: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
        sum {
          rowsRead
          rowsWritten
        }
      }
      d1StorageAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
        max {
          databaseSizeBytes
        }
      }
    }
  }
}`

type GraphQLAccount = Record<string, unknown>

type GraphQLResult =
  | { account: GraphQLAccount }
  | { account: null; reason: CloudflareErrorReason }

async function queryGraphQL(
  token: string,
  query: string,
  variables: Record<string, string>,
): Promise<GraphQLResult> {
  let res: Response
  try {
    res = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch {
    return { account: null, reason: 'unreachable' }
  }

  if (res.status === 401 || res.status === 403) {
    return { account: null, reason: 'unauthorized' }
  }
  if (!res.ok) {
    return { account: null, reason: 'query_failed' }
  }

  const body = (await res.json().catch(() => null)) as {
    data?: { viewer?: { accounts?: unknown } | null } | null
    errors?: unknown
  } | null

  // An unreadable body says nothing about permissions, so don't blame the token for it.
  if (body === null) {
    return { account: null, reason: 'query_failed' }
  }

  // A 200 carrying a populated `errors` array is how GraphQL reports schema problems.
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return { account: null, reason: 'query_failed' }
  }

  const accounts = body?.data?.viewer?.accounts
  if (!Array.isArray(accounts) || accounts.length === 0) {
    // An empty account list means the token cannot see the account at all.
    return { account: null, reason: 'unauthorized' }
  }

  const account = accounts[0]
  return typeof account === 'object' && account !== null
    ? { account: account as GraphQLAccount }
    : { account: null, reason: 'query_failed' }
}

function readNumber(source: unknown, field: string): number | null {
  if (typeof source !== 'object' || source === null) return null
  const value = (source as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Adds up `group[aggregate][field]` across every returned group. */
function sumGroups(
  groups: unknown,
  aggregate: 'sum' | 'max',
  field: string,
): number | null {
  if (!Array.isArray(groups)) return null

  let total: number | null = null
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue
    const value = readNumber((group as Record<string, unknown>)[aggregate], field)
    if (value === null) continue
    total = (total ?? 0) + value
  }
  return total
}

export async function fetchCloudflareUsage(
  env: Pick<Env, 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_API_TOKEN'>,
  now: Date,
): Promise<CloudflareUsage> {
  const accountTag = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const token = env.CLOUDFLARE_API_TOKEN?.trim()
  // Half-configured is still unusable, so never fire a doomed request.
  if (!accountTag || !token) return CLOUDFLARE_UNCONFIGURED

  const day = utcDate(now)
  const [workers, d1] = await Promise.all([
    queryGraphQL(token, WORKERS_QUERY, {
      accountTag,
      start: utcDayStart(now),
      end: now.toISOString(),
    }),
    queryGraphQL(token, D1_QUERY, { accountTag, start: day, end: day }),
  ])

  const requests = sumGroups(workers.account?.workersInvocationsAdaptive, 'sum', 'requests')
  const rowsRead = sumGroups(d1.account?.d1AnalyticsAdaptiveGroups, 'sum', 'rowsRead')
  const rowsWritten = sumGroups(d1.account?.d1AnalyticsAdaptiveGroups, 'sum', 'rowsWritten')
  // The free storage allowance is account-wide, so sum each database's peak.
  const storageBytes = sumGroups(d1.account?.d1StorageAdaptiveGroups, 'max', 'databaseSizeBytes')

  const reasons = [workers, d1].flatMap((r) => (r.account === null ? [r.reason] : []))
  const failedEverywhere = reasons.length === 2

  return {
    status: failedEverywhere ? 'error' : 'ok',
    // A bad token is the likeliest cause and the only one the user can act on, so it wins.
    reason: failedEverywhere
      ? (reasons.find((r) => r === 'unauthorized') ?? reasons[0])
      : null,
    workersRequests:
      requests === null ? null : toQuota(requests, WORKERS_FREE_REQUESTS_PER_DAY, 'day'),
    d1RowsRead:
      rowsRead === null ? null : toQuota(rowsRead, D1_FREE_ROWS_READ_PER_DAY, 'day'),
    d1RowsWritten:
      rowsWritten === null ? null : toQuota(rowsWritten, D1_FREE_ROWS_WRITTEN_PER_DAY, 'day'),
    d1StorageBytes:
      storageBytes === null ? null : toQuota(storageBytes, D1_FREE_STORAGE_BYTES, 'total'),
  }
}

let cached: { at: number; snapshot: UsageSnapshot } | null = null

export function resetUsageCache(): void {
  cached = null
}

export async function getUsageSnapshot(env: Env, now = Date.now()): Promise<UsageSnapshot> {
  if (cached && now - cached.at < USAGE_CACHE_TTL_MS) {
    return cached.snapshot
  }

  const [resend, cloudflare] = await Promise.all([
    fetchResendUsage(env),
    fetchCloudflareUsage(env, new Date(now)),
  ])

  const snapshot: UsageSnapshot = {
    fetchedAt: new Date(now).toISOString(),
    freeTier: FREE_TIER_LIMITS,
    resend,
    cloudflare,
  }

  // Never pin a transient failure for a whole TTL.
  if (resend.status !== 'error' && cloudflare.status !== 'error') {
    cached = { at: now, snapshot }
  }

  return snapshot
}
