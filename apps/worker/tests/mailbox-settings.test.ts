import { describe, expect, it, vi } from 'vitest'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import type { Env } from '../src/env'
import { createApp } from '../src/http/app'
import {
  DEFAULT_MAILBOX_SETTINGS,
  getMailboxSettings,
  isRetentionDays,
  updateMailboxSettings,
} from '../src/mailbox-settings/service'

const secret = 'test-secret-at-least-32-chars!!'

function envWith(db: D1Database): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    COOKIES_SECRET: secret,
    EMAIL_DOMAIN: 'example.com',
  }
}

function mockSettingsDb(row: { trash: number; spam: number } | null) {
  const first = vi
    .fn()
    .mockResolvedValue(
      row ? { trash_retention_days: row.trash, spam_retention_days: row.spam } : null,
    )
  const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
  const bind = vi.fn().mockReturnValue({ first, run })
  const prepare = vi.fn().mockReturnValue({ bind, first, run })
  return { prepare, bind, run, db: { prepare } as unknown as D1Database }
}

async function authedRequest(
  db: D1Database,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const app = createApp()
  const cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie('user-1', secret)}`
  return app.request(
    'http://localhost/api/mailbox-settings',
    {
      method: init.method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
    envWith(db),
  )
}

describe('isRetentionDays', () => {
  it('accepts the inclusive 1–90 range', () => {
    expect(isRetentionDays(1)).toBe(true)
    expect(isRetentionDays(30)).toBe(true)
    expect(isRetentionDays(90)).toBe(true)
  })

  it('rejects 0, 91, fractions, and non-numbers', () => {
    expect(isRetentionDays(0)).toBe(false)
    expect(isRetentionDays(91)).toBe(false)
    expect(isRetentionDays(1.5)).toBe(false)
    expect(isRetentionDays('30')).toBe(false)
    expect(isRetentionDays(null)).toBe(false)
  })
})

describe('getMailboxSettings', () => {
  it('maps the stored row', async () => {
    const { db } = mockSettingsDb({ trash: 14, spam: 7 })
    await expect(getMailboxSettings(db)).resolves.toEqual({
      trashRetentionDays: 14,
      spamRetentionDays: 7,
    })
  })

  it('falls back to defaults when the row is missing', async () => {
    const { db } = mockSettingsDb(null)
    await expect(getMailboxSettings(db)).resolves.toEqual(DEFAULT_MAILBOX_SETTINGS)
  })

  it('clamps out-of-range stored values', async () => {
    const { db } = mockSettingsDb({ trash: 0, spam: 900 })
    await expect(getMailboxSettings(db)).resolves.toEqual({
      trashRetentionDays: 1,
      spamRetentionDays: 90,
    })
  })
})

describe('updateMailboxSettings', () => {
  it('keeps untouched fields at their current value', async () => {
    const { bind, db } = mockSettingsDb({ trash: 14, spam: 7 })

    await expect(updateMailboxSettings(db, { spamRetentionDays: 3 })).resolves.toEqual({
      trashRetentionDays: 14,
      spamRetentionDays: 3,
    })
    expect(bind).toHaveBeenLastCalledWith(14, 3)
  })
})

describe('mailbox settings routes', () => {
  it('requires a session', async () => {
    const app = createApp()
    const { db } = mockSettingsDb({ trash: 30, spam: 30 })
    const res = await app.request('http://localhost/api/mailbox-settings', {}, envWith(db))
    expect(res.status).toBe(401)
  })

  it('GET returns the current settings', async () => {
    const { db } = mockSettingsDb({ trash: 30, spam: 12 })
    const res = await authedRequest(db, { method: 'GET' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      trashRetentionDays: 30,
      spamRetentionDays: 12,
    })
  })

  it('PATCH persists a valid update', async () => {
    const { db } = mockSettingsDb({ trash: 30, spam: 30 })
    const res = await authedRequest(db, {
      method: 'PATCH',
      body: { trashRetentionDays: 7, spamRetentionDays: 90 },
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      trashRetentionDays: 7,
      spamRetentionDays: 90,
    })
  })

  it.each([0, 91, 1.5, '30', null])('PATCH rejects %p', async (value) => {
    const { db } = mockSettingsDb({ trash: 30, spam: 30 })
    const res = await authedRequest(db, {
      method: 'PATCH',
      body: { trashRetentionDays: value },
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_retention_days' })
  })

  it('PATCH rejects an empty patch', async () => {
    const { db } = mockSettingsDb({ trash: 30, spam: 30 })
    const res = await authedRequest(db, { method: 'PATCH', body: {} })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_body' })
  })
})
