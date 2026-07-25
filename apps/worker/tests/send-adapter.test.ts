import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudflareSendAdapter } from '../src/adapters/send/cloudflare'
import { createMailchannelsSendAdapter } from '../src/adapters/send/mailchannels'
import { createResendSendAdapter } from '../src/adapters/send/resend'
import { getSendAdapter } from '../src/adapters/send'
import type { Env } from '../src/env'
import { createApp } from '../src/http/app'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import { checkRateLimit, incrementRateLimit, resetRateLimits } from '../src/send/rate-limit'

const baseInput = {
  from: 'me@example.com',
  to: ['you@example.com'],
  subject: 'Hi',
  text: 'Hello',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetRateLimits()
})

describe('cloudflare send adapter', () => {
  it('returns not_configured when EMAIL binding is missing', async () => {
    const adapter = createCloudflareSendAdapter({})
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
  })

  it('calls EMAIL.send and returns provider id', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'cf-1' })
    const adapter = createCloudflareSendAdapter({ EMAIL: { send } })
    await expect(adapter.send({ ...baseInput, html: '<p>Hi</p>', replyTo: 'r@example.com' })).resolves.toEqual({
      id: 'cf-1',
    })
    expect(send).toHaveBeenCalledWith({
      from: 'me@example.com',
      to: ['you@example.com'],
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hi</p>',
      replyTo: 'r@example.com',
    })
  })

  it('maps invalid address throws to invalid_address', async () => {
    const send = vi.fn().mockRejectedValue(new Error('invalid destination address'))
    const adapter = createCloudflareSendAdapter({ EMAIL: { send } })
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'invalid_address' })
  })

  it('maps other provider throws to provider_error', async () => {
    const send = vi.fn().mockRejectedValue(new Error('upstream timeout'))
    const adapter = createCloudflareSendAdapter({ EMAIL: { send } })
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'provider_error' })
  })
})

describe('resend send adapter', () => {
  it('returns not_configured without API key', async () => {
    const adapter = createResendSendAdapter({})
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
  })

  it('POSTs to Resend API with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_123' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createResendSendAdapter({ RESEND_API_KEY: 'rk_test' })
    await expect(
      adapter.send({ ...baseInput, html: '<b>x</b>', replyTo: 'r@example.com' }),
    ).resolves.toEqual({ id: 're_123' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer rk_test',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'me@example.com',
      to: ['you@example.com'],
      subject: 'Hi',
      text: 'Hello',
      html: '<b>x</b>',
      reply_to: 'r@example.com',
    })
  })

  it('maps 422 to invalid_address and 5xx to provider_error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad', { status: 422 }))
      .mockResolvedValueOnce(new Response('err', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createResendSendAdapter({ RESEND_API_KEY: 'rk_test' })
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'invalid_address' })
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'provider_error' })
  })
})

describe('mailchannels send adapter', () => {
  it('returns not_configured without API key', async () => {
    const adapter = createMailchannelsSendAdapter({})
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
  })

  it('POSTs authenticated MailChannels Email API payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createMailchannelsSendAdapter({ MAILCHANNELS_API_KEY: 'mc_key' })
    await expect(adapter.send({ ...baseInput, html: '<p>x</p>' })).resolves.toEqual({})

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.mailchannels.net/tx/v1/send')
    expect(init.headers).toMatchObject({
      'X-Api-Key': 'mc_key',
      'Content-Type': 'application/json',
    })
    const body = JSON.parse(String(init.body)) as {
      from: { email: string }
      personalizations: { to: { email: string }[] }[]
      content: { type: string; value: string }[]
    }
    expect(body.from.email).toBe('me@example.com')
    expect(body.personalizations[0]?.to).toEqual([{ email: 'you@example.com' }])
    expect(body.content).toEqual(
      expect.arrayContaining([
        { type: 'text/plain', value: 'Hello' },
        { type: 'text/html', value: '<p>x</p>' },
      ]),
    )
  })
})

describe('getSendAdapter', () => {
  it('switches on SEND_CHANNEL', async () => {
    const cf = getSendAdapter({ SEND_CHANNEL: 'cloudflare' } as Env)
    const rs = getSendAdapter({ SEND_CHANNEL: 'resend' } as Env)
    const mc = getSendAdapter({ SEND_CHANNEL: 'mailchannels' } as Env)
    await expect(cf.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
    await expect(rs.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
    await expect(mc.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
  })
})

describe('rate limit', () => {
  it('allows up to 30 sends per hour then rate_limited', () => {
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit('me@example.com')).toEqual({ ok: true })
      incrementRateLimit('me@example.com')
    }
    expect(checkRateLimit('me@example.com')).toEqual({ ok: false, error: 'rate_limited' })
    expect(checkRateLimit('other@example.com')).toEqual({ ok: true })
  })

  it('check does not consume quota until increment', () => {
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit('me@example.com')).toEqual({ ok: true })
    }
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit('me@example.com')).toEqual({ ok: true })
      incrementRateLimit('me@example.com')
    }
    expect(checkRateLimit('me@example.com')).toEqual({ ok: false, error: 'rate_limited' })
  })
})

describe('POST /api/messages/send', () => {
  const secret = 'test-secret-at-least-32-chars!!'

  function mockDb(opts: {
    alias?: { id: string; address: string; enabled: number; is_default: number; created_at: number } | null
    insertRun?: ReturnType<typeof vi.fn>
    replyRow?: { from_addr: string } | null
  }) {
    const first = vi.fn()
    const run = opts.insertRun ?? vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ first, run })
    const prepare = vi.fn().mockReturnValue({ bind })

    first.mockImplementation(async () => {
      const sql = String(prepare.mock.calls[prepare.mock.calls.length - 1]?.[0] ?? '')
      if (sql.includes('FROM aliases')) return opts.alias === undefined ? null : opts.alias
      if (sql.includes('FROM messages')) return opts.replyRow ?? null
      return null
    })

    return { prepare, bind, first, run } as unknown as D1Database & {
      prepare: ReturnType<typeof vi.fn>
      bind: ReturnType<typeof vi.fn>
      first: ReturnType<typeof vi.fn>
      run: ReturnType<typeof vi.fn>
    }
  }

  async function authedCookie() {
    const value = await createSessionCookie('user-1', secret)
    return `${SESSION_COOKIE_NAME}=${value}`
  }

  it('requires auth', async () => {
    const app = createApp()
    const env = {
      DB: mockDb({}),
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      SEND_CHANNEL: 'resend',
      EMAIL_DOMAIN: 'example.com',
      RESEND_API_KEY: 'rk',
    } satisfies Env

    const res = await app.request(
      'http://localhost/api/messages/send',
      { method: 'POST', body: JSON.stringify(baseInput) },
      env,
    )
    expect(res.status).toBe(401)
  })

  it('rejects disabled or missing fromAliasId', async () => {
    const app = createApp()
    const db = mockDb({
      alias: {
        id: 'a1',
        address: 'me@example.com',
        enabled: 0,
        is_default: 1,
        created_at: 1,
      },
    })
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      SEND_CHANNEL: 'resend',
      EMAIL_DOMAIN: 'example.com',
      RESEND_API_KEY: 'rk',
    } satisfies Env

    const res = await app.request(
      'http://localhost/api/messages/send',
      {
        method: 'POST',
        headers: {
          Cookie: await authedCookie(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromAliasId: 'a1',
          to: ['you@example.com'],
          subject: 'Hi',
          text: 'Hello',
        }),
      },
      env,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_address' })
  })

  it('on provider failure does not insert sent and returns error payload', async () => {
    const insertRun = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const db = mockDb({
      alias: {
        id: 'a1',
        address: 'me@example.com',
        enabled: 1,
        is_default: 1,
        created_at: 1,
      },
      insertRun,
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const app = createApp()
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      SEND_CHANNEL: 'resend',
      EMAIL_DOMAIN: 'example.com',
      RESEND_API_KEY: 'rk',
    } satisfies Env

    const res = await app.request(
      'http://localhost/api/messages/send',
      {
        method: 'POST',
        headers: {
          Cookie: await authedCookie(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromAliasId: 'a1',
          to: ['you@example.com'],
          subject: 'Hi',
          text: 'Hello',
        }),
      },
      env,
    )
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({
      error: 'provider_error',
      message: expect.any(String),
    })
    expect(insertRun).not.toHaveBeenCalled()
    // Failures must not consume soft send quota
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit('me@example.com')).toEqual({ ok: true })
      incrementRateLimit('me@example.com')
    }
    expect(checkRateLimit('me@example.com')).toEqual({ ok: false, error: 'rate_limited' })
  })

  it('on success inserts folder=sent direction=outbound with provider id', async () => {
    const insertRun = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const db = mockDb({
      alias: {
        id: 'a1',
        address: 'me@example.com',
        enabled: 1,
        is_default: 1,
        created_at: 1,
      },
      insertRun,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_ok' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const app = createApp()
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      SEND_CHANNEL: 'resend',
      EMAIL_DOMAIN: 'example.com',
      RESEND_API_KEY: 'rk',
    } satisfies Env

    const res = await app.request(
      'http://localhost/api/messages/send',
      {
        method: 'POST',
        headers: {
          Cookie: await authedCookie(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromAliasId: 'a1',
          to: ['you@example.com'],
          subject: 'Hi',
          text: 'Hello',
          html: '<p>Hello</p>',
        }),
      },
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toEqual(expect.any(String))

    const insertSql = String(db.prepare.mock.calls.find((c) => String(c[0]).includes('INSERT INTO messages'))?.[0] ?? '')
    expect(insertSql).toMatch(/INSERT INTO messages/i)
    expect(insertRun).toHaveBeenCalled()
    const bindArgs = db.bind.mock.calls.find((c) => c.includes('sent') || c.includes('outbound'))
    // bind order: id, aliasId, folder, direction, from, to, subject, text, html, is_read, has_att, provider_id, created_at
    const insertBind = db.bind.mock.calls.find((c) => c[2] === 'sent' && c[3] === 'outbound')
    expect(insertBind).toBeTruthy()
    expect(insertBind?.[10]).toBe(0) // has_unsupported_attachments
    expect(insertBind?.[11]).toBe('re_ok')
  })
})
