import { describe, expect, it, vi } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password'
import { createSessionCookie, readSession } from '../src/auth/session'
import { createApp } from '../src/http/app'
import type { Env } from '../src/env'

describe('password', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct-horse')
    expect(await verifyPassword('correct-horse', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('session', () => {
  it('round-trips signed cookie', async () => {
    const cookie = await createSessionCookie('user-1', 'test-secret-at-least-32-chars!!')
    const session = await readSession(`mankr_session=${cookie}`, 'test-secret-at-least-32-chars!!')
    expect(session).toEqual({ userId: 'user-1' })
  })

  it('rejects tampered cookie', async () => {
    const cookie = await createSessionCookie('user-1', 'test-secret-at-least-32-chars!!')
    const session = await readSession(`mankr_session=${cookie}x`, 'test-secret-at-least-32-chars!!')
    expect(session).toBeNull()
  })
})

describe('GET /api/setup', () => {
  const secret = 'test-secret-at-least-32-chars!!'

  function mockDb(userCount: number) {
    const first = vi.fn().mockResolvedValue({ n: userCount })
    const bind = vi.fn().mockReturnValue({ first })
    const prepare = vi.fn().mockReturnValue({ bind, first })
    return { prepare } as unknown as D1Database
  }

  function envWith(db: D1Database): Env {
    return {
      DB: db,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: secret,
      EMAIL_DOMAIN: 'example.com',
    }
  }

  it('returns initialized=false when users table is empty', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/api/setup', { method: 'GET' }, envWith(mockDb(0)))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ initialized: false })
  })

  it('returns initialized=true when users already exist', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/api/setup', { method: 'GET' }, envWith(mockDb(1)))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ initialized: true })
  })
})
