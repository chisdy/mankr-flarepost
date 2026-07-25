import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password'
import { createSessionCookie, readSession } from '../src/auth/session'

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
