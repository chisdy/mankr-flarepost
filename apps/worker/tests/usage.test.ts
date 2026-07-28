import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import type { Env } from '../src/env'
import { createApp } from '../src/http/app'
import { utcDayStartMs, utcMonthStartMs } from '../src/usage/quota'
import {
  getSendProviderUsage,
  recordSendStatements,
  SEND_EVENT_RETENTION_MS,
  SEND_PROVIDER_LIMITS,
} from '../src/usage/send-usage'
import {
  D1_FREE_ROWS_READ_PER_DAY,
  D1_FREE_ROWS_WRITTEN_PER_DAY,
  D1_FREE_STORAGE_BYTES,
  WORKERS_FREE_REQUESTS_PER_DAY,
  fetchCloudflareUsage,
  getUsageSnapshot,
  resetUsageCache,
  toQuota,
  utcDate,
  utcDayStart,
} from '../src/usage/service'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetUsageCache()
})

type ReportRow = {
  daily_used: number | null
  monthly_used: number | null
  captured_at: number
}

/** Answers only the two queries `send-usage.ts` issues, keyed by the window start it binds. */
function usageDb(opts: { report?: ReportRow | null; unitsSince?: Record<number, number> }) {
  const calls: { sql: string; args: unknown[] }[] = []

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args })
          return {
            async first() {
              if (sql.includes('provider_quota_reports')) return opts.report ?? null
              if (sql.includes('send_usage_events')) {
                return { units: opts.unitsSince?.[Number(args[1])] ?? 0 }
              }
              return null
            },
            async run() {
              return { success: true }
            },
          }
        },
      }
    },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ success: true }))
    },
  } as unknown as D1Database

  return { db, calls }
}

function graphqlResponse(account: Record<string, unknown>) {
  return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), {
    status: 200,
  })
}

describe('SEND_PROVIDER_LIMITS', () => {
  it('locks free-tier send limits for each registered provider', () => {
    expect(SEND_PROVIDER_LIMITS).toEqual({
      resend: { emailsPerDay: 100, emailsPerMonth: 3_000 },
      brevo: { emailsPerDay: 300, emailsPerMonth: 9_000 },
      maileroo: { emailsPerDay: null, emailsPerMonth: 3_000 },
    })
  })
})

describe('toQuota', () => {
  it('derives remaining and never goes negative', () => {
    expect(toQuota(30, 100, 'day')).toEqual({
      used: 30,
      limit: 100,
      remaining: 70,
      window: 'day',
    })
    expect(toQuota(140, 100, 'day').remaining).toBe(0)
  })

  it('clamps negative usage and rounds fractional values', () => {
    expect(toQuota(-5, 100, 'day').used).toBe(0)
    expect(toQuota(10.6, 100, 'day').used).toBe(11)
  })
})

describe('utc window helpers', () => {
  it('pins the start of the UTC day', () => {
    const now = new Date('2026-07-28T09:30:00.000Z')
    expect(utcDayStart(now)).toBe('2026-07-28T00:00:00Z')
    expect(utcDate(now)).toBe('2026-07-28')
  })

  it('pins day and month starts in UTC regardless of the local zone', () => {
    const now = new Date('2026-07-28T09:30:00.000Z')
    expect(utcDayStartMs(now)).toBe(Date.parse('2026-07-28T00:00:00.000Z'))
    expect(utcMonthStartMs(now)).toBe(Date.parse('2026-07-01T00:00:00.000Z'))
  })
})

describe('recordSendStatements', () => {
  const now = Date.parse('2026-07-28T09:30:00.000Z')

  it('charges one unit per recipient and prunes events past the retention window', () => {
    const { db, calls } = usageDb({})

    const statements = recordSendStatements(db, { provider: 'resend', units: 3 }, now)

    expect(statements).toHaveLength(2)
    expect(calls[0].sql).toContain('INSERT INTO send_usage_events')
    expect(calls[0].args.slice(1)).toEqual(['resend', 3, now])
    expect(calls[1].sql).toContain('DELETE FROM send_usage_events')
    expect(calls[1].args).toEqual([now - SEND_EVENT_RETENTION_MS])
  })

  it('never records a send as costing nothing', () => {
    const { db, calls } = usageDb({})
    recordSendStatements(db, { provider: 'resend', units: 0 }, now)
    expect(calls[0].args[2]).toBe(1)
  })

  it('upserts the provider report only when the provider volunteered figures', () => {
    const { db: quiet, calls: quietCalls } = usageDb({})
    recordSendStatements(quiet, { provider: 'resend', units: 1 }, now)
    expect(quietCalls.some((c) => c.sql.includes('provider_quota_reports'))).toBe(false)

    const { db, calls } = usageDb({})
    const statements = recordSendStatements(
      db,
      { provider: 'resend', units: 1, quota: { dailyUsed: 7, monthlyUsed: 42 } },
      now,
    )

    expect(statements).toHaveLength(3)
    const upsert = calls.find((c) => c.sql.includes('provider_quota_reports'))
    expect(upsert?.args).toEqual(['resend', 7, 42, now])
  })
})

describe('getSendProviderUsage', () => {
  const now = new Date('2026-07-28T09:30:00.000Z')
  const dayStart = utcDayStartMs(now)
  const monthStart = utcMonthStartMs(now)
  const limits = SEND_PROVIDER_LIMITS.resend
  const dailyLimit = limits.emailsPerDay as number
  const monthlyLimit = limits.emailsPerMonth as number

  it('reports not_configured without touching the database', async () => {
    const { db, calls } = usageDb({})

    const usage = await getSendProviderUsage(db, 'resend', false, now)

    expect(usage).toEqual({
      provider: 'resend',
      status: 'not_configured',
      limits,
      daily: null,
      monthly: null,
      reported: null,
      observed: { daily: 0, monthly: 0 },
    })
    expect(calls).toHaveLength(0)
  })

  it('falls back to its own tally before the provider has reported anything', async () => {
    const { db } = usageDb({
      report: null,
      unitsSince: { [dayStart]: 4, [monthStart]: 26 },
    })

    const usage = await getSendProviderUsage(db, 'resend', true, now)

    expect(usage.status).toBe('ok')
    expect(usage.reported).toBeNull()
    expect(usage.observed).toEqual({ daily: 4, monthly: 26 })
    expect(usage.daily).toEqual(toQuota(4, dailyLimit, 'day'))
    expect(usage.monthly).toEqual(toQuota(26, monthlyLimit, 'month'))
  })

  // The provider sees traffic this app never sent, so its larger figure has to win.
  it('prefers the provider figure when it exceeds the local tally', async () => {
    const { db } = usageDb({
      report: { daily_used: 30, monthly_used: 300, captured_at: dayStart + 1_000 },
      unitsSince: { [dayStart]: 2, [monthStart]: 5 },
    })

    const usage = await getSendProviderUsage(db, 'resend', true, now)

    expect(usage.daily?.used).toBe(30)
    expect(usage.monthly?.used).toBe(300)
    expect(usage.observed).toEqual({ daily: 2, monthly: 5 })
    expect(usage.reported).toEqual({
      dailyUsed: 30,
      monthlyUsed: 300,
      capturedAt: new Date(dayStart + 1_000).toISOString(),
    })
  })

  // And the local tally covers everything sent since that figure was captured.
  it('prefers the local tally when it has moved past the provider figure', async () => {
    const { db } = usageDb({
      report: { daily_used: 3, monthly_used: 9, captured_at: dayStart + 1_000 },
      unitsSince: { [dayStart]: 11, [monthStart]: 40 },
    })

    const usage = await getSendProviderUsage(db, 'resend', true, now)

    expect(usage.daily?.used).toBe(11)
    expect(usage.monthly?.used).toBe(40)
  })

  it('ignores a stale report for the window it no longer describes', async () => {
    // Captured yesterday: useless for today, still valid for this month.
    const { db } = usageDb({
      report: { daily_used: 90, monthly_used: 200, captured_at: dayStart - 1 },
      unitsSince: { [dayStart]: 2, [monthStart]: 5 },
    })

    const usage = await getSendProviderUsage(db, 'resend', true, now)

    expect(usage.daily?.used).toBe(2)
    expect(usage.monthly?.used).toBe(200)
  })

  it('ignores a report captured before this month entirely', async () => {
    const { db } = usageDb({
      report: { daily_used: 90, monthly_used: 2_900, captured_at: monthStart - 1 },
      unitsSince: { [dayStart]: 1, [monthStart]: 6 },
    })

    const usage = await getSendProviderUsage(db, 'resend', true, now)

    expect(usage.daily?.used).toBe(1)
    expect(usage.monthly?.used).toBe(6)
  })

  // Paid plans omit the daily figure; that is unknown, not zero, so the local tally stands.
  it('treats a null reported window as unknown rather than zero', async () => {
    const { db } = usageDb({
      report: { daily_used: null, monthly_used: 500, captured_at: dayStart + 1_000 },
      unitsSince: { [dayStart]: 8, [monthStart]: 8 },
    })

    const usage = await getSendProviderUsage(db, 'resend', true, now)

    expect(usage.daily?.used).toBe(8)
    expect(usage.monthly?.used).toBe(500)
    expect(usage.reported?.dailyUsed).toBeNull()
  })
})

describe('fetchCloudflareUsage', () => {
  const now = new Date('2026-07-28T09:30:00.000Z')

  it('treats half-configured credentials as not_configured without any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const expected = {
      status: 'not_configured',
      reason: null,
      workersRequests: null,
      d1RowsRead: null,
      d1RowsWritten: null,
      d1StorageBytes: null,
    }

    await expect(fetchCloudflareUsage({}, now)).resolves.toEqual(expected)
    await expect(
      fetchCloudflareUsage({ CLOUDFLARE_ACCOUNT_ID: 'acc' }, now),
    ).resolves.toEqual(expected)
    await expect(
      fetchCloudflareUsage({ CLOUDFLARE_API_TOKEN: 'tok' }, now),
    ).resolves.toEqual(expected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sums Workers requests and D1 rows across returned groups', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string }
      if (body.query.includes('workersInvocationsAdaptive')) {
        return Promise.resolve(
          graphqlResponse({
            workersInvocationsAdaptive: [
              { sum: { requests: 900 } },
              { sum: { requests: 100 } },
            ],
          }),
        )
      }
      return Promise.resolve(
        graphqlResponse({
          d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 2_000, rowsWritten: 50 } }],
          d1StorageAdaptiveGroups: [{ max: { databaseSizeBytes: 1_048_576 } }],
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )

    expect(usage.status).toBe('ok')
    expect(usage.workersRequests).toEqual({
      used: 1_000,
      limit: WORKERS_FREE_REQUESTS_PER_DAY,
      remaining: 99_000,
      window: 'day',
    })
    expect(usage.d1RowsRead).toEqual({
      used: 2_000,
      limit: D1_FREE_ROWS_READ_PER_DAY,
      remaining: D1_FREE_ROWS_READ_PER_DAY - 2_000,
      window: 'day',
    })
    expect(usage.d1RowsWritten).toEqual({
      used: 50,
      limit: D1_FREE_ROWS_WRITTEN_PER_DAY,
      remaining: D1_FREE_ROWS_WRITTEN_PER_DAY - 50,
      window: 'day',
    })
    expect(usage.d1StorageBytes).toEqual({
      used: 1_048_576,
      limit: D1_FREE_STORAGE_BYTES,
      remaining: D1_FREE_STORAGE_BYTES - 1_048_576,
      window: 'total',
    })
  })

  it('scopes Workers to the UTC day and D1 to the current date', async () => {
    const fetchMock = vi.fn().mockResolvedValue(graphqlResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )

    const payloads = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String((init as RequestInit).body)) as {
        query: string
        variables: Record<string, string>
      },
    )
    const workers = payloads.find((p) => p.query.includes('workersInvocationsAdaptive'))
    const d1 = payloads.find((p) => p.query.includes('d1AnalyticsAdaptiveGroups'))

    expect(workers?.variables).toEqual({
      accountTag: 'acc',
      start: '2026-07-28T00:00:00Z',
      end: '2026-07-28T09:30:00.000Z',
    })
    expect(d1?.variables).toEqual({
      accountTag: 'acc',
      start: '2026-07-28',
      end: '2026-07-28',
    })
  })

  it('keeps partial results when only one dataset fails', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string }
      if (body.query.includes('workersInvocationsAdaptive')) {
        return Promise.resolve(graphqlResponse({ workersInvocationsAdaptive: [{ sum: { requests: 5 } }] }))
      }
      return Promise.resolve(new Response('boom', { status: 500 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )

    expect(usage.status).toBe('ok')
    expect(usage.workersRequests?.used).toBe(5)
    expect(usage.d1RowsRead).toBeNull()
    expect(usage.d1StorageBytes).toBeNull()
  })

  it('reports error when every query fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )
    expect(usage.status).toBe('error')
    expect(usage.workersRequests).toBeNull()
    expect(usage.reason).toBe('unreachable')
  })

  it('reports error when the account list is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: { viewer: { accounts: [] } } }), { status: 200 }),
        ),
      ),
    )

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )
    expect(usage.status).toBe('error')
    // An account the token cannot see is a permissions problem, not a transient one.
    expect(usage.reason).toBe('unauthorized')
  })

  it('does not blame the token when the body is not readable JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response('<html>gateway</html>', { status: 200 })),
      ),
    )

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )
    expect(usage.reason).toBe('query_failed')
  })

  it.each([401, 403])('reports the reason as unauthorized on HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status })))

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )
    expect(usage.status).toBe('error')
    expect(usage.reason).toBe('unauthorized')
  })

  it('treats a 200 carrying GraphQL errors as query_failed', async () => {
    // A fresh Response per call: a body can only be consumed once.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ errors: [{ message: 'bad field' }], data: null }), {
            status: 200,
          }),
        ),
      ),
    )

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )
    expect(usage.status).toBe('error')
    expect(usage.reason).toBe('query_failed')
  })

  it('prefers unauthorized over a transient reason when both queries fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string }
        return body.query.includes('workersInvocationsAdaptive')
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(new Response('nope', { status: 403 }))
      }),
    )

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )
    expect(usage.reason).toBe('unauthorized')
  })

  it('leaves the reason null while any dataset still succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string }
        return body.query.includes('workersInvocationsAdaptive')
          ? Promise.resolve(graphqlResponse({ workersInvocationsAdaptive: [{ sum: { requests: 5 } }] }))
          : Promise.resolve(new Response('nope', { status: 403 }))
      }),
    )

    const usage = await fetchCloudflareUsage(
      { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' },
      now,
    )
    expect(usage.status).toBe('ok')
    expect(usage.reason).toBeNull()
  })
})

describe('getUsageSnapshot', () => {
  const baseEnv = {
    COOKIES_SECRET: 'test-secret-at-least-32-chars!!',
    RESEND_API_KEY: 'rk_test',
    CLOUDFLARE_ACCOUNT_ID: 'acc',
    CLOUDFLARE_API_TOKEN: 'tok',
    DB: usageDb({}).db,
  } as Env

  it('serves a cached snapshot within the TTL and refetches after it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(graphqlResponse({ workersInvocationsAdaptive: [{ sum: { requests: 1 } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await getUsageSnapshot(baseEnv, 1_000)
    const cached = await getUsageSnapshot(baseEnv, 30_000)
    expect(cached).toBe(first)
    // Two GraphQL queries per snapshot: Workers and D1.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await getUsageSnapshot(baseEnv, 1_000 + 60_001)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not cache a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const first = await getUsageSnapshot(baseEnv, 1_000)
    expect(first.cloudflare.status).toBe('error')

    const second = await getUsageSnapshot(baseEnv, 2_000)
    expect(second).not.toBe(first)
  })

  it('stamps fetchedAt as an ISO timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(graphqlResponse({})))

    const snapshot = await getUsageSnapshot(baseEnv, Date.parse('2026-07-28T09:30:00.000Z'))
    expect(snapshot.fetchedAt).toBe('2026-07-28T09:30:00.000Z')
  })

  it('carries one entry per known sending provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(graphqlResponse({})))

    const snapshot = await getUsageSnapshot(baseEnv, 1_000)
    expect(snapshot.sendProviders.map((p) => p.provider)).toEqual(
      Object.keys(SEND_PROVIDER_LIMITS),
    )
  })
})

describe('GET /api/usage', () => {
  const secret = 'test-secret-at-least-32-chars!!'

  const env = {
    DB: usageDb({}).db,
    ASSETS: {} as Fetcher,
    COOKIES_SECRET: secret,
    EMAIL_DOMAIN: 'example.com',
  } satisfies Env

  it('requires auth', async () => {
    const res = await createApp().request('http://localhost/api/usage', {}, env)
    expect(res.status).toBe(401)
  })

  it('returns both providers as not_configured when no credentials are set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie('user-1', secret)}`
    const res = await createApp().request(
      'http://localhost/api/usage',
      { headers: { Cookie: cookie } },
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      fetchedAt: string
      sendProviders: { provider: string; status: string }[]
      cloudflare: { status: string }
    }
    expect(body.sendProviders.every((p) => p.status === 'not_configured')).toBe(true)
    expect(body.cloudflare.status).toBe('not_configured')
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // The UI renders the free-tier reference table straight from this payload, so it must
  // ship even when no provider is configured.
  it('always ships the free-tier limits', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie('user-1', secret)}`
    const res = await createApp().request(
      'http://localhost/api/usage',
      { headers: { Cookie: cookie } },
      env,
    )

    const body = (await res.json()) as { freeTier: Record<string, number> }
    expect(body.freeTier).toEqual({
      workersRequestsPerDay: 100_000,
      d1RowsReadPerDay: 5_000_000,
      d1RowsWrittenPerDay: 100_000,
      d1StorageBytes: 5 * 1024 * 1024 * 1024,
    })
  })
})
