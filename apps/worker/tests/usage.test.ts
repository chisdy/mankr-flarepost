import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import type { Env } from '../src/env'
import { createApp } from '../src/http/app'
import {
  D1_FREE_ROWS_READ_PER_DAY,
  D1_FREE_ROWS_WRITTEN_PER_DAY,
  D1_FREE_STORAGE_BYTES,
  RESEND_FREE_DAILY_EMAILS,
  RESEND_FREE_MONTHLY_EMAILS,
  WORKERS_FREE_REQUESTS_PER_DAY,
  fetchCloudflareUsage,
  fetchResendUsage,
  getUsageSnapshot,
  parseQuotaHeader,
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

function resendResponse(headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify({ data: [] }), { status, headers })
}

function graphqlResponse(account: Record<string, unknown>) {
  return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), {
    status: 200,
  })
}

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

describe('parseQuotaHeader', () => {
  it('returns null for a missing or non-numeric header', () => {
    expect(parseQuotaHeader(null)).toBeNull()
    expect(parseQuotaHeader('')).toBeNull()
    expect(parseQuotaHeader('   ')).toBeNull()
    expect(parseQuotaHeader('unlimited')).toBeNull()
  })

  it('parses numeric headers, including zero', () => {
    expect(parseQuotaHeader('0')).toBe(0)
    expect(parseQuotaHeader(' 42 ')).toBe(42)
  })
})

describe('utc window helpers', () => {
  it('pins the start of the UTC day', () => {
    const now = new Date('2026-07-28T09:30:00.000Z')
    expect(utcDayStart(now)).toBe('2026-07-28T00:00:00Z')
    expect(utcDate(now)).toBe('2026-07-28')
  })
})

describe('fetchResendUsage', () => {
  it('reports not_configured without an API key', async () => {
    await expect(fetchResendUsage({})).resolves.toEqual({
      status: 'not_configured',
      daily: null,
      monthly: null,
    })
  })

  it('maps quota headers against the free-tier limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      resendResponse({
        'x-resend-daily-quota': '12',
        'x-resend-monthly-quota': '340',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchResendUsage({ RESEND_API_KEY: 'rk_test' })).resolves.toEqual({
      status: 'ok',
      daily: { used: 12, limit: RESEND_FREE_DAILY_EMAILS, remaining: 88, window: 'day' },
      monthly: {
        used: 340,
        limit: RESEND_FREE_MONTHLY_EMAILS,
        remaining: 2_660,
        window: 'month',
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails?limit=1')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer rk_test' })
  })

  it('leaves the daily quota null when the header is absent, never zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(resendResponse({ 'x-resend-monthly-quota': '10' })),
    )

    const usage = await fetchResendUsage({ RESEND_API_KEY: 'rk_test' })
    expect(usage.status).toBe('ok')
    expect(usage.daily).toBeNull()
    expect(usage.monthly?.used).toBe(10)
  })

  it('still reads quota headers off a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(resendResponse({ 'x-resend-daily-quota': '100' }, 429)),
    )

    const usage = await fetchResendUsage({ RESEND_API_KEY: 'rk_test' })
    expect(usage.status).toBe('ok')
    expect(usage.daily).toEqual({
      used: 100,
      limit: RESEND_FREE_DAILY_EMAILS,
      remaining: 0,
      window: 'day',
    })
  })

  it('reports error on an auth failure or a network throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })))
    await expect(fetchResendUsage({ RESEND_API_KEY: 'rk_test' })).resolves.toEqual({
      status: 'error',
      daily: null,
      monthly: null,
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchResendUsage({ RESEND_API_KEY: 'rk_test' })).resolves.toEqual({
      status: 'error',
      daily: null,
      monthly: null,
    })
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
  const baseEnv = { RESEND_API_KEY: 'rk_test' } as Env

  it('serves a cached snapshot within the TTL and refetches after it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(resendResponse({ 'x-resend-daily-quota': '1' }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await getUsageSnapshot(baseEnv, 1_000)
    const cached = await getUsageSnapshot(baseEnv, 30_000)
    expect(cached).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await getUsageSnapshot(baseEnv, 1_000 + 60_001)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const first = await getUsageSnapshot(baseEnv, 1_000)
    expect(first.resend.status).toBe('error')

    const second = await getUsageSnapshot(baseEnv, 2_000)
    expect(second).not.toBe(first)
  })

  it('stamps fetchedAt as an ISO timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resendResponse({})))

    const snapshot = await getUsageSnapshot(baseEnv, Date.parse('2026-07-28T09:30:00.000Z'))
    expect(snapshot.fetchedAt).toBe('2026-07-28T09:30:00.000Z')
  })
})

describe('GET /api/usage', () => {
  const secret = 'test-secret-at-least-32-chars!!'

  const env = {
    DB: {} as D1Database,
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
      resend: { status: string }
      cloudflare: { status: string }
    }
    expect(body.resend.status).toBe('not_configured')
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
      resendEmailsPerDay: 100,
      resendEmailsPerMonth: 3_000,
      workersRequestsPerDay: 100_000,
      d1RowsReadPerDay: 5_000_000,
      d1RowsWrittenPerDay: 100_000,
      d1StorageBytes: 5 * 1024 * 1024 * 1024,
    })
  })
})
