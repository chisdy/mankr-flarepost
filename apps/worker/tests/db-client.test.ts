import { describe, expect, it, vi } from 'vitest'
import { insertUser } from '../src/db/client'

function mockDb(changes: number) {
  const run = vi.fn().mockResolvedValue({ meta: { changes }, success: true })
  const bind = vi.fn().mockReturnValue({ run })
  const prepare = vi.fn().mockReturnValue({ bind })
  return { db: { prepare } as unknown as D1Database, prepare, bind, run }
}

describe('insertUser bootstrap', () => {
  it('uses COUNT=0 conditional INSERT (not plain VALUES)', async () => {
    const { db, prepare } = mockDb(1)
    await insertUser(db, {
      id: 'u1',
      username: 'admin',
      passwordHash: 'hash',
      displayName: null,
      createdAt: 1,
    })
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/INSERT\s+INTO\s+users/i)
    expect(sql).toMatch(/SELECT\s+\?\s*,\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*\?/i)
    expect(sql).toMatch(/WHERE\s*\(\s*SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM\s+users\s*\)\s*=\s*0/i)
    expect(sql).not.toMatch(/VALUES\s*\(/i)
  })

  it('returns true when a row was inserted', async () => {
    const { db } = mockDb(1)
    await expect(
      insertUser(db, {
        id: 'u1',
        username: 'a',
        passwordHash: 'h',
        displayName: null,
        createdAt: 1,
      }),
    ).resolves.toBe(true)
  })

  it('returns false when users already exist (changes=0 race loser)', async () => {
    const { db } = mockDb(0)
    await expect(
      insertUser(db, {
        id: 'u2',
        username: 'other',
        passwordHash: 'h',
        displayName: null,
        createdAt: 2,
      }),
    ).resolves.toBe(false)
  })
})
