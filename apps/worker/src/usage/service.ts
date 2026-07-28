import {
  isProviderCredentialConfigured,
  type SendProviderId,
} from '../adapters/send'
import type { Env } from '../env'
import {
  toQuota,
  utcDate,
  utcDayStart,
  type ProviderStatus,
  type Quota,
} from './quota'
import {
  getSendProviderUsage,
  SEND_PROVIDER_LIMITS,
  type SendProviderUsage,
} from './send-usage'

export {
  toQuota,
  utcDate,
  utcDayStart,
  type ProviderStatus,
  type Quota,
  type QuotaWindow,
} from './quota'

/**
 * Free-plan ceilings. A Paid account's real limits are higher, so the UI must
 * label these as free-tier allowances rather than absolute remaining capacity.
 */
export const WORKERS_FREE_REQUESTS_PER_DAY = 100_000
export const D1_FREE_ROWS_READ_PER_DAY = 5_000_000
export const D1_FREE_ROWS_WRITTEN_PER_DAY = 100_000
export const D1_FREE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024

/** Per-isolate best-effort cache; a cold start simply re-fetches. */
export const USAGE_CACHE_TTL_MS = 60_000

const CLOUDFLARE_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'

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
  workersRequestsPerDay: number
  d1RowsReadPerDay: number
  d1RowsWrittenPerDay: number
  d1StorageBytes: number
}

/** Sent to the client so the UI never hardcodes a second copy of these numbers. */
export const FREE_TIER_LIMITS: FreeTierLimits = {
  workersRequestsPerDay: WORKERS_FREE_REQUESTS_PER_DAY,
  d1RowsReadPerDay: D1_FREE_ROWS_READ_PER_DAY,
  d1RowsWrittenPerDay: D1_FREE_ROWS_WRITTEN_PER_DAY,
  d1StorageBytes: D1_FREE_STORAGE_BYTES,
}

export type UsageSnapshot = {
  fetchedAt: string
  freeTier: FreeTierLimits
  /** One entry per sending service, so a second provider needs no shape change. */
  sendProviders: SendProviderUsage[]
  cloudflare: CloudflareUsage
}

const CLOUDFLARE_UNCONFIGURED: CloudflareUsage = {
  status: 'not_configured',
  reason: null,
  workersRequests: null,
  d1RowsRead: null,
  d1RowsWritten: null,
  d1StorageBytes: null,
}

/**
 * A provider is usable when its API key exists in the sealed DB table or the matching env
 * secret. Send figures still come from D1 — see `send-usage.ts`.
 */
async function isSendProviderConfigured(
  env: Env,
  provider: SendProviderId,
): Promise<boolean> {
  return isProviderCredentialConfigured(env, provider)
}

export async function fetchSendProviderUsage(
  env: Env,
  now: Date,
): Promise<SendProviderUsage[]> {
  const providers = Object.keys(SEND_PROVIDER_LIMITS) as SendProviderId[]
  return Promise.all(
    providers.map(async (provider) =>
      getSendProviderUsage(
        env.DB,
        provider,
        await isSendProviderConfigured(env, provider),
        now,
      ),
    ),
  )
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

  const [sendProviders, cloudflare] = await Promise.all([
    fetchSendProviderUsage(env, new Date(now)),
    fetchCloudflareUsage(env, new Date(now)),
  ])

  const snapshot: UsageSnapshot = {
    fetchedAt: new Date(now).toISOString(),
    freeTier: FREE_TIER_LIMITS,
    sendProviders,
    cloudflare,
  }

  // Never pin a transient failure for a whole TTL.
  if (cloudflare.status !== 'error') {
    cached = { at: now, snapshot }
  }

  return snapshot
}
