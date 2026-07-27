import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashApiKey } from '../src/api-keys/service'
import { createApp } from '../src/http/app'
import type { Env } from '../src/env'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'

const secret = 'test-secret-at-least-32-chars!!'
const plaintextKey = 'mfp_live_test_secret_key_aaaaaaaaaaaaaaaa'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type KeyRow = {
  id: string
  name: string
  key_prefix: string
  key_hash: string
  alias_id: string
  alias_address: string
  alias_enabled: number
  enabled: number
  hourly_limit: number
  daily_limit: number
  created_at: number
}

function makeKeyRow(overrides: Partial<KeyRow> = {}): KeyRow {
  return {
    id: 'key-1',
    name: 'shop',
    key_prefix: 'mfp_live_test_sec',
    key_hash: 'will-be-set',
    alias_id: 'a1',
    alias_address: 'noreply@example.com',
    alias_enabled: 1,
    enabled: 1,
    hourly_limit: 30,
    daily_limit: 200,
    created_at: 1,
    ...overrides,
  }
}

function mockPublicSendDb(opts: {
  key?: KeyRow | null
  hourCount?: number
  dayCount?: number
  batch?: ReturnType<typeof vi.fn>
}) {
  const key = opts.key === undefined ? makeKeyRow() : opts.key
  const batch = opts.batch ?? vi.fn().mockResolvedValue([])
  const prepare = vi.fn((sql: string) => {
    const s = String(sql)
    const first = vi.fn(async () => {
      if (s.includes('FROM api_keys') && s.includes('key_hash')) {
        return key
      }
      if (s.includes('FROM api_key_usage')) {
        return {
          hour_count: opts.hourCount ?? 0,
          day_count: opts.dayCount ?? 0,
        }
      }
      return null
    })
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const all = vi.fn().mockResolvedValue({ results: [] })
    const bind = vi.fn().mockReturnValue({ first, run, all, bind: vi.fn() })
    return { bind, first, run, all }
  })
  return { prepare, batch } as unknown as D1Database & {
    prepare: ReturnType<typeof vi.fn>
    batch: ReturnType<typeof vi.fn>
  }
}

function envWith(db: D1Database, extras: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    COOKIES_SECRET: secret,
    SEND_CHANNEL: 'resend',
    EMAIL_DOMAIN: 'example.com',
    RESEND_API_KEY: 'rk_test',
    ...extras,
  }
}

async function sendRequest(
  env: Env,
  init: {
    authorization?: string | null
    body?: unknown
  },
) {
  const app = createApp()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.authorization !== null) {
    headers.Authorization = init.authorization ?? `Bearer ${plaintextKey}`
  }
  return app.request(
    'http://localhost/api/v1/send',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(
        init.body ?? {
          to: ['user@example.com'],
          subject: 'Hi',
          text: 'Hello',
        },
      ),
    },
    env,
  )
}

describe('POST /api/v1/send', () => {
  it('returns 401 without Bearer token', async () => {
    const db = mockPublicSendDb({})
    const res = await sendRequest(envWith(db), { authorization: null })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' })
  })

  it('returns 401 for unknown key', async () => {
    const db = mockPublicSendDb({ key: null })
    const res = await sendRequest(envWith(db), {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' })
  })

  it('returns 401 for disabled key (same message as missing)', async () => {
    const keyHash = await hashApiKey(plaintextKey)
    const db = mockPublicSendDb({ key: makeKeyRow({ enabled: 0, key_hash: keyHash }) })
    const res = await sendRequest(envWith(db), {})
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('unauthorized')
    expect(body.message).toBe('Missing or invalid API key.')
  })

  it('returns 401 when bound alias is disabled', async () => {
    const keyHash = await hashApiKey(plaintextKey)
    const db = mockPublicSendDb({
      key: makeKeyRow({ alias_enabled: 0, key_hash: keyHash }),
    })
    const res = await sendRequest(envWith(db), {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' })
  })

  it('returns 429 when hourly quota is exhausted', async () => {
    const keyHash = await hashApiKey(plaintextKey)
    const db = mockPublicSendDb({
      key: makeKeyRow({ key_hash: keyHash, hourly_limit: 30 }),
      hourCount: 30,
      dayCount: 30,
    })
    const res = await sendRequest(envWith(db), {})
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: 'quota_exceeded' })
  })

  it('returns 400 when recipient list exceeds 10', async () => {
    const keyHash = await hashApiKey(plaintextKey)
    const db = mockPublicSendDb({ key: makeKeyRow({ key_hash: keyHash }) })
    const to = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`)
    const res = await sendRequest(envWith(db), { body: { to, subject: 'Hi', text: 'Hello' } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_address' })
  })

  it('on success writes send log + usage and never touches messages', async () => {
    const keyHash = await hashApiKey(plaintextKey)
    const batch = vi.fn().mockResolvedValue([])
    const db = mockPublicSendDb({ key: makeKeyRow({ key_hash: keyHash }), batch })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_ok' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendRequest(envWith(db), {
      body: {
        to: ['user@example.com'],
        subject: 'Order',
        text: 'Thanks',
        html: '<p>Thanks</p>',
        replyTo: 'support@example.com',
      },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; providerMessageId: string }
    expect(body.id).toEqual(expect.any(String))
    expect(body.providerMessageId).toBe('re_ok')

    expect(batch).toHaveBeenCalled()
    const statements = batch.mock.calls[0]![0] as unknown[]
    expect(statements.length).toBeGreaterThanOrEqual(2)

    const preparedSql = db.prepare.mock.calls.map((c) => String(c[0]))
    expect(preparedSql.some((s) => /INSERT INTO api_send_logs/i.test(s))).toBe(true)
    expect(preparedSql.some((s) => /INSERT INTO api_key_usage/i.test(s))).toBe(true)
    expect(preparedSql.some((s) => /INSERT INTO messages/i.test(s))).toBe(false)
  })

  it('does not require a session cookie', async () => {
    const keyHash = await hashApiKey(plaintextKey)
    const db = mockPublicSendDb({ key: makeKeyRow({ key_hash: keyHash }) })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_ok' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const app = createApp()
    const res = await app.request(
      'http://localhost/api/v1/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${plaintextKey}`,
          'Content-Type': 'application/json',
          // No Cookie — must still succeed
        },
        body: JSON.stringify({
          to: ['user@example.com'],
          subject: 'Hi',
          text: 'Hello',
        }),
      },
      envWith(db),
    )
    expect(res.status).toBe(201)
  })
})

describe('GET /api/api-keys', () => {
  it('requires session', async () => {
    const app = createApp()
    const db = mockPublicSendDb({})
    const res = await app.request('http://localhost/api/api-keys', { method: 'GET' }, envWith(db))
    expect(res.status).toBe(401)
  })

  it('lists keys with empty usage for an authenticated admin', async () => {
    const app = createApp()
    const cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie('user-1', secret)}`
    const keyRow = makeKeyRow({ key_hash: 'abc' })
    const prepare = vi.fn((sql: string) => {
      const s = String(sql)
      const first = vi.fn().mockResolvedValue(null)
      const all = vi.fn().mockResolvedValue({
        results: s.includes('FROM api_keys') ? [keyRow] : [],
      })
      const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
      const bind = vi.fn().mockReturnValue({ first, run, all })
      return { bind, first, run, all }
    })
    const db = { prepare, batch: vi.fn() } as unknown as D1Database

    const res = await app.request(
      'http://localhost/api/api-keys',
      { method: 'GET', headers: { Cookie: cookie } },
      envWith(db),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { apiKeys: Array<{ id: string; usage: { sent24h: number } }> }
    expect(body.apiKeys).toHaveLength(1)
    expect(body.apiKeys[0]!.id).toBe('key-1')
    expect(body.apiKeys[0]!.usage.sent24h).toBe(0)
  })
})
