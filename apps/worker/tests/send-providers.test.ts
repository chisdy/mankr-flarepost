import { describe, expect, it, vi } from 'vitest'
import { createBrevoSendAdapter } from '../src/adapters/send/brevo'
import { createMailerooSendAdapter } from '../src/adapters/send/maileroo'
import { resolveSendConfig } from '../src/adapters/send/resolve'
import { seal } from '../src/crypto/secret-box'
import type { Env } from '../src/env'
import { updateMailboxSettings } from '../src/mailbox-settings/service'

const secret = 'test-secret-at-least-32-chars!!'
const baseInput = {
  from: 'me@example.com',
  to: ['you@example.com'],
  subject: 'Hi',
  text: 'Hello',
}

function mockResolveDb(opts: {
  sendProvider?: string | null
  secrets?: Record<string, { ciphertext: string; iv: string; key_hint?: string }>
}) {
  const store = {
    send_provider: opts.sendProvider ?? null,
    secrets: { ...(opts.secrets ?? {}) },
  }

  const prepare = vi.fn((sql: string) => {
    const s = String(sql)
    const first = vi.fn(async () => {
      if (s.includes('send_provider FROM mailbox_settings')) {
        return { send_provider: store.send_provider }
      }
      if (s.includes('FROM send_provider_secrets') && s.includes('WHERE provider')) {
        return null
      }
      if (s.includes('trash_retention_days')) {
        return { trash_retention_days: 30, spam_retention_days: 30 }
      }
      return null
    })
    const run = vi.fn().mockResolvedValue({ success: true })
    const all = vi.fn().mockResolvedValue({
      results: Object.entries(store.secrets).map(([provider, row]) => ({
        provider,
        key_hint: row.key_hint ?? null,
      })),
    })
    const bind = vi.fn((...args: unknown[]) => {
      const boundFirst = vi.fn(async () => {
        if (s.includes('FROM send_provider_secrets') && s.includes('WHERE provider')) {
          const provider = String(args[0])
          return store.secrets[provider] ?? null
        }
        return first()
      })
      const boundRun = vi.fn(async () => {
        if (s.includes('UPDATE mailbox_settings SET send_provider')) {
          store.send_provider = args[0] === null ? null : String(args[0] ?? store.send_provider)
        }
        if (s.includes('INSERT INTO mailbox_settings') && s.includes('send_provider')) {
          store.send_provider = String(args[0])
        }
        if (
          s.includes('INSERT INTO mailbox_settings') &&
          s.includes('trash_retention_days') &&
          !s.includes('send_provider')
        ) {
          // retention-only upsert must leave send_provider alone
        }
        if (s.includes('INSERT INTO send_provider_secrets')) {
          store.secrets[String(args[0])] = {
            ciphertext: String(args[1]),
            iv: String(args[2]),
            key_hint: String(args[3]),
          }
        }
        if (s.includes('DELETE FROM send_provider_secrets')) {
          delete store.secrets[String(args[0])]
        }
        return { success: true, meta: { changes: 1 } }
      })
      return { first: boundFirst, run: boundRun, all }
    })
    return { bind, first, run, all }
  })

  return {
    db: { prepare } as unknown as D1Database,
    store,
    prepare,
  }
}

describe('brevo send adapter', () => {
  it('POSTs to Brevo with api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'brevo_1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createBrevoSendAdapter('bx_test')
    await expect(
      adapter.send({ ...baseInput, html: '<b>x</b>', replyTo: 'r@example.com' }),
    ).resolves.toEqual({ id: 'brevo_1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.headers).toMatchObject({
      'api-key': 'bx_test',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      sender: { email: 'me@example.com' },
      to: [{ email: 'you@example.com' }],
      subject: 'Hi',
      textContent: 'Hello',
      htmlContent: '<b>x</b>',
      replyTo: { email: 'r@example.com' },
    })
  })

  it('maps 400 to invalid_address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })))
    await expect(createBrevoSendAdapter('bx').send(baseInput)).resolves.toEqual({
      error: 'invalid_address',
    })
  })
})

describe('maileroo send adapter', () => {
  it('POSTs to Maileroo with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { reference_id: 'mr_1' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createMailerooSendAdapter('mr_test')
    await expect(adapter.send(baseInput)).resolves.toEqual({ id: 'mr_1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://smtp.maileroo.com/api/v2/emails')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer mr_test' })
  })

  it('maps 422 to invalid_address and 5xx to provider_error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad', { status: 422 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createMailerooSendAdapter('mr')
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'invalid_address' })
    await expect(adapter.send(baseInput)).resolves.toEqual({ error: 'provider_error' })
  })
})

describe('resolveSendConfig', () => {
  it('defaults to resend with env key', async () => {
    const { db } = mockResolveDb({})
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      EMAIL_DOMAIN: 'example.com',
      RESEND_API_KEY: 'rk_env',
    } satisfies Env

    await expect(resolveSendConfig(env)).resolves.toEqual({
      provider: 'resend',
      activeSource: 'default',
      apiKey: 'rk_env',
      apiKeySource: 'env',
    })
  })

  it('uses SEND_PROVIDER env when DB has no override', async () => {
    const { db } = mockResolveDb({})
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      EMAIL_DOMAIN: 'example.com',
      SEND_PROVIDER: 'brevo',
      BREVO_API_KEY: 'bx_env',
    } satisfies Env

    await expect(resolveSendConfig(env)).resolves.toMatchObject({
      provider: 'brevo',
      activeSource: 'env',
      apiKey: 'bx_env',
      apiKeySource: 'env',
    })
  })

  it('ignores illegal SEND_PROVIDER values', async () => {
    const { db } = mockResolveDb({})
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      EMAIL_DOMAIN: 'example.com',
      SEND_PROVIDER: 'sendgrid',
      RESEND_API_KEY: 'rk',
    } satisfies Env

    await expect(resolveSendConfig(env)).resolves.toMatchObject({
      provider: 'resend',
      activeSource: 'default',
    })
  })

  it('prefers DB active provider and sealed key over env', async () => {
    const sealed = await seal('bx_db_key', secret)
    const { db } = mockResolveDb({
      sendProvider: 'brevo',
      secrets: { brevo: sealed },
    })
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      EMAIL_DOMAIN: 'example.com',
      SEND_PROVIDER: 'resend',
      RESEND_API_KEY: 'rk_env',
      BREVO_API_KEY: 'bx_env',
    } satisfies Env

    await expect(resolveSendConfig(env)).resolves.toEqual({
      provider: 'brevo',
      activeSource: 'database',
      apiKey: 'bx_db_key',
      apiKeySource: 'database',
    })
  })

  it('falls back to env when sealed secret cannot be decrypted', async () => {
    const sealed = await seal('bx_db_key', 'other-secret-key-material!!!!')
    const { db } = mockResolveDb({
      sendProvider: 'brevo',
      secrets: { brevo: sealed },
    })
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      EMAIL_DOMAIN: 'example.com',
      BREVO_API_KEY: 'bx_env',
    } satisfies Env

    await expect(resolveSendConfig(env)).resolves.toEqual({
      provider: 'brevo',
      activeSource: 'database',
      apiKey: 'bx_env',
      apiKeySource: 'env',
    })
  })
})

describe('retention upsert leaves send_provider alone', () => {
  it('does not bind send_provider when updating retention days', async () => {
    let capturedSendProvider: string | null = 'brevo'
    const prepare = vi.fn((sql: string) => {
      const first = vi.fn(async () => {
        if (String(sql).includes('trash_retention_days')) {
          return { trash_retention_days: 14, spam_retention_days: 7 }
        }
        return null
      })
      const run = vi.fn().mockResolvedValue({ success: true })
      const bind = vi.fn((...args: unknown[]) => {
        if (
          String(sql).includes('INSERT INTO mailbox_settings') &&
          String(sql).includes('trash_retention_days')
        ) {
          // Only retention columns are written — send_provider must stay untouched.
          expect(args).toEqual([14, 3])
          expect(String(sql)).not.toContain('send_provider')
        }
        return { first, run }
      })
      return { bind, first, run }
    })
    const db = { prepare } as unknown as D1Database

    await updateMailboxSettings(db, { spamRetentionDays: 3 })
    expect(capturedSendProvider).toBe('brevo')
  })
})
