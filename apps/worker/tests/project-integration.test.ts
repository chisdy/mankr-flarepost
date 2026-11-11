import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sqliteD1 } from './helpers/sqlite-d1'
import { createApp } from '../src/http/app'
import { createAlias } from '../src/aliases/service'
import {
  createApiKey,
  ApiKeyLimitError,
  InvalidApiKeyInputError,
} from '../src/api-keys/service'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import { IDEMPOTENCY_WINDOW_MS } from '../src/send/requests'
import type { Env } from '../src/env'

const cookieSecret = 'local-integration-test-secret-at-least-32-chars'
let database: ReturnType<typeof sqliteD1>
let env: Env
let cookie: string
const app = createApp()

beforeEach(async () => {
  database = sqliteD1()
  env = {
    DB: database.db,
    EMAIL_DOMAIN: 'example.com',
    COOKIES_SECRET: cookieSecret,
    RESEND_API_KEY: 'mock-provider-key',
    ASSETS: {} as Fetcher,
  }
  cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie('admin', cookieSecret)}`
})
afterEach(() => {
  database.sqlite.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function admin(path: string, body?: unknown, method = 'POST') {
  return app.request(
    `http://localhost${path}`,
    {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  )
}
async function project() {
  const alias = await createAlias(database.db, {
    address: 'notify',
    domain: env.EMAIL_DOMAIN,
  })
  const key = await createApiKey(database.db, {
    name: 'Store',
    aliasId: alias.id,
  })
  return { alias, ...key }
}
function send(
  secret: string,
  key: string | null = 'order/123',
  body: unknown = {
    to: ['recipient@example.com'],
    subject: 'Order',
    text: 'Private body',
  },
) {
  return app.request(
    'http://localhost/api/v1/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        ...(key === null ? {} : { 'Idempotency-Key': key }),
      },
      body: JSON.stringify(body),
    },
    env,
  )
}
function count(table: string) {
  return (
    database.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number
    }
  ).n
}
function providerSuccess() {
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: 'provider-123' }), { status: 200 }),
    )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('address and key creation with real SQL', () => {
  it('preserves the legacy request and returns a complete entity for the new flow', async () => {
    const legacy = await admin('/api/aliases', { address: 'Hello@other.org' })
    expect(legacy.status).toBe(201)
    const old = (await legacy.json()) as { id: string }
    expect(old).toMatchObject({
      address: 'hello@example.com',
      enabled: true,
      isDefault: true,
    })
    const response = await admin('/api/aliases', { localPart: 'orders' })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: expect.any(String),
      address: 'orders@example.com',
      isDefault: false,
    })
    expect(
      database.sqlite
        .prepare('SELECT id FROM aliases WHERE is_default = 1')
        .all(),
    ).toEqual([{ id: old.id }])
  })
  it.each([
    { localPart: 'bad@example.com' },
    { localPart: '.bad' },
    { localPart: 'a..b' },
    { localPart: 'a'.repeat(65) },
    { localPart: 'one', address: 'two' },
    {},
    null,
  ])('rejects invalid new address input %j', async (body) => {
    expect((await admin('/api/aliases', body)).status).toBe(400)
    expect(count('aliases')).toBe(0)
  })
  it('creates more than five distinct aliases concurrently and assigns only one default', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      admin('/api/aliases', { localPart: `address-${i}` }),
    ))
    expect(responses.every((response) => response.status === 201)).toBe(true)
    expect(count('aliases')).toBe(8)
    expect(
      database.sqlite
        .prepare('SELECT id FROM aliases WHERE is_default = 1')
        .all(),
    ).toHaveLength(1)
    const duplicate = await admin('/api/aliases', { localPart: 'ADDRESS-7' })
    expect(duplicate.status).toBe(400)
    expect(await duplicate.json()).toMatchObject({ error: 'invalid_address' })
    const capabilities = await admin('/api/integration-capabilities', undefined, 'GET')
    expect(await capabilities.json()).toMatchObject({ aliases: { limit: null, used: 8, remaining: null } })
  })
  it('enforces the last key slot and rejects disabled aliases', async () => {
    const alias = await createAlias(database.db, {
      address: 'app',
      domain: env.EMAIL_DOMAIN,
    })
    for (let i = 0; i < 19; i++)
      await createApiKey(database.db, { name: `key-${i}`, aliasId: alias.id })
    const results = await Promise.allSettled(
      [1, 2].map((i) =>
        createApiKey(database.db, { name: `last-${i}`, aliasId: alias.id }),
      ),
    )
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      (
        results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult
      ).reason,
    ).toBeInstanceOf(ApiKeyLimitError)
    expect(count('api_keys')).toBe(20)
    database.sqlite
      .prepare('UPDATE aliases SET enabled = 0 WHERE id = ?')
      .run(alias.id)
    await expect(
      createApiKey(database.db, { name: 'disabled', aliasId: alias.id }),
    ).rejects.toBeInstanceOf(InvalidApiKeyInputError)
  })
  it('capabilities are admin-only and contain no credentials or readiness claims', async () => {
    expect(
      (
        await app.request(
          'http://localhost/api/integration-capabilities',
          {},
          env,
        )
      ).status,
    ).toBe(401)
    const response = await admin(
      '/api/integration-capabilities',
      undefined,
      'GET',
    )
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({
      domain: 'example.com',
      aliases: { limit: null, used: 0, remaining: null },
      apiKeys: { limit: 20 },
      outbound: { configured: true, domainVerified: null },
      inbound: { status: 'unverified' },
      smtp: { mode: 'unconfigured' },
    })
    expect(text).not.toContain('mock-provider-key')
  })
})

describe('HTTP retries and persistence', () => {
  it('replays the same result once, ignores caller From, and counts requests vs recipients separately', async () => {
    const { secret } = await project()
    const fetcher = providerSuccess()
    const body = {
      from: 'intruder@other.org',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Order',
      text: 'Private body',
    }
    const first = await send(secret, 'same', body)
    expect(first.status).toBe(201)
    const result = await first.json()
    const replay = await send(secret, 'same', body)
    expect(replay.status).toBe(201)
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(result)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(payload.from).toBe('notify@example.com')
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toMatch(
      /^mfp\//,
    )
    expect(count('api_send_logs')).toBe(1)
    expect(count('messages')).toBe(0)
    expect(
      database.sqlite.prepare('SELECT count FROM api_key_usage').get(),
    ).toEqual({ count: 1 })
    expect(
      database.sqlite.prepare('SELECT units FROM send_usage_events').all(),
    ).toEqual([{ units: 2 }])
    expect(
      JSON.stringify(
        database.sqlite.prepare('SELECT * FROM api_send_requests').all(),
      ),
    ).not.toContain('Private body')
  })
  it('blocks concurrent ownership and conflicts without invoking the provider twice', async () => {
    const { secret } = await project()
    let finish!: (value: Response) => void
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const first = send(secret)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const concurrent = await send(secret)
    expect(concurrent.status).toBe(409)
    expect(concurrent.headers.get('Retry-After')).toBe('5')
    expect(await concurrent.json()).toMatchObject({
      error: 'request_in_progress',
    })
    const conflict = await send(secret, 'order/123', {
      to: ['a@example.com'],
      subject: 'Different',
      text: 'Changed',
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      error: 'idempotency_conflict',
    })
    finish(new Response('{"id":"accepted"}', { status: 200 }))
    expect((await first).status).toBe(201)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('never automatically retries an unknown provider outcome', async () => {
    const { secret } = await project()
    const fetcher = vi.fn().mockRejectedValue(new Error('timeout'))
    vi.stubGlobal('fetch', fetcher)
    for (let i = 0; i < 2; i++) {
      const response = await send(secret)
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({
        error: 'provider_error',
        state: 'unknown',
        retryable: false,
      })
    }
    expect(fetcher).toHaveBeenCalledOnce()
    expect(count('api_key_usage')).toBe(0)
    expect(
      database.sqlite.prepare('SELECT error_code FROM api_send_logs').get(),
    ).toEqual({ error_code: 'outcome_unknown' })
  })
  it('handles provider acceptance followed by failed local commit conservatively', async () => {
    const { secret } = await project()
    const fetcher = providerSuccess()
    vi.spyOn(database.db, 'batch').mockRejectedValueOnce(
      new Error('D1 unavailable'),
    )
    const response = await send(secret)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      state: 'unknown',
      retryable: false,
    })
    expect((await send(secret)).status).toBe(502)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(count('api_key_usage')).toBe(0)
  })
  it.each([true, false])(
    'preserves unknown outcomes when log persistence fails (idempotency: %s)',
    async (withIdempotency) => {
      const { secret } = await project()
      const fetcher = vi.fn().mockRejectedValue(new Error('timeout'))
      vi.stubGlobal('fetch', fetcher)
      vi.spyOn(database.db, 'batch').mockRejectedValueOnce(
        new Error('D1 unavailable'),
      )

      const response = await send(secret, withIdempotency ? 'unknown/db' : null)
      expect(response.status).toBe(502)
      const result = await response.json()
      expect(result).toMatchObject({
        error: 'provider_error',
        state: 'unknown',
        retryable: false,
        requestId: expect.any(String),
      })
      expect(count('api_send_logs')).toBe(0)
      expect(count('api_key_usage')).toBe(0)
      expect(count('send_usage_events')).toBe(0)
      if (withIdempotency) {
        expect(
          database.sqlite
            .prepare('SELECT id, state FROM api_send_requests')
            .get(),
        ).toEqual({ id: result.requestId, state: 'unknown' })
        const replay = await send(secret, 'unknown/db')
        expect(replay.status).toBe(502)
        expect(await replay.json()).toMatchObject({
          state: 'unknown',
          retryable: false,
          requestId: result.requestId,
        })
      } else {
        expect(count('api_send_requests')).toBe(0)
      }
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )
  it('keeps the unknown response and blocks resending if the fallback state write also fails', async () => {
    const { secret } = await project()
    const fetcher = vi.fn().mockRejectedValue(new Error('timeout'))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(database.db, 'batch').mockRejectedValueOnce(
      new Error('D1 unavailable'),
    )
    const prepare = database.db.prepare.bind(database.db)
    vi.spyOn(database.db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      // bind() returns a fresh statement, so fail the bound write too.
      if (sql.startsWith('UPDATE api_send_requests')) {
        const bind = statement.bind.bind(statement)
        vi.spyOn(statement, 'bind').mockImplementation((...args) => {
          const bound = bind(...args)
          vi.spyOn(bound, 'run').mockRejectedValue(
            new Error('D1 still unavailable'),
          )
          return bound
        })
      }
      return statement
    })

    const response = await send(secret)
    expect(response.status).toBe(502)
    const result = await response.json()
    expect(result).toMatchObject({
      state: 'unknown',
      retryable: false,
      requestId: expect.any(String),
    })
    expect(
      database.sqlite.prepare('SELECT id, state FROM api_send_requests').get(),
    ).toEqual({ id: result.requestId, state: 'processing' })
    const pending = await send(secret)
    expect(pending.status).toBe(409)
    expect(await pending.json()).toMatchObject({
      error: 'request_in_progress',
      requestId: result.requestId,
    })
    database.sqlite
      .prepare('UPDATE api_send_requests SET updated_at = ?')
      .run(Date.now() - 130_000)
    const replay = await send(secret)
    expect(replay.status).toBe(502)
    expect(await replay.json()).toMatchObject({
      state: 'unknown',
      retryable: false,
      requestId: result.requestId,
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(count('api_send_logs')).toBe(0)
    expect(count('api_key_usage')).toBe(0)
  })
  it('reports abandoned processing as unknown and atomically reuses expired keys', async () => {
    const { secret } = await project()
    const fetcher = providerSuccess()
    expect((await send(secret)).status).toBe(201)
    database.sqlite
      .prepare(
        "UPDATE api_send_requests SET state = 'processing', updated_at = ?",
      )
      .run(Date.now() - 130_000)
    expect(await (await send(secret)).json()).toMatchObject({
      state: 'unknown',
      retryable: false,
    })
    database.sqlite
      .prepare('UPDATE api_send_requests SET expires_at = ?, created_at = ?')
      .run(Date.now() - 1, Date.now() - IDEMPOTENCY_WINDOW_MS - 1)
    expect((await send(secret)).status).toBe(201)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(count('api_send_requests')).toBe(1)
  })
  it('replays accepted requests even when the quota has since been exhausted', async () => {
    const { secret, apiKey } = await project()
    providerSuccess()
    expect((await send(secret)).status).toBe(201)
    database.sqlite
      .prepare('UPDATE api_keys SET hourly_limit = 1 WHERE id = ?')
      .run(apiKey.id)
    expect((await send(secret)).status).toBe(201)
    expect((await send(secret, 'new-request')).status).toBe(429)
  })
  it('returns deterministic known failures without repeating the upstream request', async () => {
    const { secret } = await project()
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 422 }))
    vi.stubGlobal('fetch', fetcher)
    expect((await send(secret)).status).toBe(400)
    expect((await send(secret)).status).toBe(400)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['', 'has space', 'x'.repeat(129)])(
    'rejects malformed idempotency header %j before calling upstream',
    async (key) => {
      const { secret } = await project()
      const fetcher = providerSuccess()
      const response = await send(secret, key)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: 'invalid_idempotency_key',
      })
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
  it.each([
    null,
    [],
    { to: ['invalid'], subject: 'a', text: 'b' },
    {
      to: ['a@example.com'],
      subject: 'a',
      text: 'b',
      replyTo: 'bad\r\naddress',
    },
  ])(
    'rejects malformed payload %j before provider invocation',
    async (body) => {
      const { secret } = await project()
      const fetcher = providerSuccess()
      expect((await send(secret, 'validation', body)).status).toBe(400)
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
})

describe('administrative logs and lifecycle', () => {
  it('paginates tied timestamps without duplicates and keeps Bearer keys out of admin routes', async () => {
    const { secret, apiKey } = await project()
    const statement = database.sqlite.prepare(
      `INSERT INTO api_send_logs(id,api_key_id,from_addr,to_addrs,subject,status,created_at) VALUES(?,?,?,?,?,'sent',?)`,
    )
    const now = Date.now()
    for (const id of ['a', 'b', 'c'])
      statement.run(
        id,
        apiKey.id,
        'notify@example.com',
        '["a@example.com"]',
        'Order',
        now,
      )
    const first = await admin('/api/api-send-logs?limit=2', undefined, 'GET')
    const page = (await first.json()) as {
      logs: { id: string }[]
      nextCursor: string
    }
    expect(page.logs.map((row) => row.id)).toEqual(['c', 'b'])
    const second = await admin(
      `/api/api-send-logs?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,
      undefined,
      'GET',
    )
    expect(await second.json()).toMatchObject({
      logs: [{ id: 'a', projectName: 'Store' }],
      nextCursor: null,
    })
    for (const path of [
      '/api/api-send-logs',
      '/api/aliases',
      '/api/api-keys',
      '/api/integration-capabilities',
    ]) {
      expect(
        (
          await app.request(
            `http://localhost${path}`,
            { headers: { Authorization: `Bearer ${secret}` } },
            env,
          )
        ).status,
      ).toBe(401)
    }
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=abc',
      'cursor=bad',
      'status=delivered',
    ]) {
      expect(
        (await admin(`/api/api-send-logs?${query}`, undefined, 'GET')).status,
      ).toBe(400)
    }
  })
  it('disabling one key retains history, alias disabling blocks every bound key, deletion cascades', async () => {
    const { alias, apiKey, secret } = await project()
    const second = await createApiKey(database.db, {
      name: 'Second',
      aliasId: alias.id,
    })
    const fetcher = providerSuccess()
    expect((await send(secret)).status).toBe(201)
    expect(
      (await admin(`/api/api-keys/${apiKey.id}`, { enabled: false }, 'PATCH'))
        .status,
    ).toBe(200)
    expect((await send(secret, 'disabled')).status).toBe(401)
    expect((await send(second.secret, 'second')).status).toBe(201)
    expect(count('api_send_logs')).toBe(2)
    await admin(`/api/aliases/${alias.id}`, { enabled: false }, 'PATCH')
    expect((await send(second.secret, 'disabled-alias')).status).toBe(401)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(
      (await admin(`/api/api-keys/${apiKey.id}`, undefined, 'DELETE')).status,
    ).toBe(204)
    expect(count('api_send_logs')).toBe(1)
    expect(count('api_send_requests')).toBe(1)
    expect(count('api_key_usage')).toBe(1)
  })
})
