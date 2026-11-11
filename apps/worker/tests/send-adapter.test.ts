import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResendSendAdapter } from '../src/adapters/send/resend'
import { getSendAdapter } from '../src/adapters/send'
import type { Env } from '../src/env'
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

describe('resend send adapter', () => {
  it('returns not_configured without API key', async () => {
    const adapter = createResendSendAdapter('')
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
  })

  it('POSTs to Resend API with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_123' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createResendSendAdapter('rk_test')
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

  // A successful send is the only response that carries these headers, which is why the
  // usage page depends on capturing them here rather than polling for them.
  it('captures the quota figures Resend attaches to a successful send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 're_123' }), {
          status: 200,
          headers: {
            'x-resend-daily-quota': '12',
            'x-resend-monthly-quota': '340',
          },
        }),
      ),
    )

    const adapter = createResendSendAdapter('rk_test')
    await expect(adapter.send(baseInput)).resolves.toEqual({
      id: 're_123',
      quota: { dailyUsed: 12, monthlyUsed: 340 },
    })
  })

  it('leaves a window null when only the other one is reported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 're_123' }), {
          status: 200,
          // Paid plans omit the daily header entirely.
          headers: { 'x-resend-monthly-quota': '7' },
        }),
      ),
    )

    const adapter = createResendSendAdapter('rk_test')
    await expect(adapter.send(baseInput)).resolves.toEqual({
      id: 're_123',
      quota: { dailyUsed: null, monthlyUsed: 7 },
    })
  })

  it('omits quota entirely when the headers are absent or unparsable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'a' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'b' }), {
          status: 200,
          headers: { 'x-resend-daily-quota': 'unlimited' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createResendSendAdapter('rk_test')
    await expect(adapter.send(baseInput)).resolves.toEqual({ id: 'a' })
    await expect(adapter.send(baseInput)).resolves.toEqual({ id: 'b' })
  })

  it('maps 422 to invalid_address and 5xx to provider_error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad', { status: 422 }))
      .mockResolvedValueOnce(new Response('err', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createResendSendAdapter('rk_test')
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'invalid_address' })
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'provider_error' })
  })
})

function emptyResolveDb(): D1Database {
  const first = vi.fn().mockResolvedValue(null)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const run = vi.fn().mockResolvedValue({ success: true })
  const bind = vi.fn().mockReturnValue({ first, run, all })
  const prepare = vi.fn().mockReturnValue({ bind, first, run, all })
  return { prepare } as unknown as D1Database
}

describe('getSendAdapter', () => {
  it('returns the Resend adapter when env provides a Resend key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_only' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = await getSendAdapter({
      DB: emptyResolveDb(),
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: 'test-secret-at-least-32-chars!!',
      EMAIL_DOMAIN: 'example.com',
      RESEND_API_KEY: 'rk_test',
    })
    await expect(adapter.send(baseInput)).resolves.toEqual({ id: 're_only' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails')
  })

  it('reports not_configured when no API key is available', async () => {
    const adapter = await getSendAdapter({
      DB: emptyResolveDb(),
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: 'test-secret-at-least-32-chars!!',
      EMAIL_DOMAIN: 'example.com',
    })
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'not_configured' })
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
