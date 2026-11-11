import { describe, expect, it, vi } from 'vitest'
import {
  normalizeAddress,
  patchAlias,
  shouldAutoDefaultOnCreate,
} from '../src/aliases/service'

describe('normalizeAddress', () => {
  it('appends domain to local-part', () => {
    expect(normalizeAddress('hello', 'example.com')).toBe('hello@example.com')
  })

  it('normalizes full address to EMAIL_DOMAIN', () => {
    expect(normalizeAddress('hello@example.com', 'example.com')).toBe('hello@example.com')
    expect(normalizeAddress('Hello@OTHER.org', 'example.com')).toBe('hello@example.com')
  })

  it('trims and lowercases', () => {
    expect(normalizeAddress('  FooBar  ', 'Mail.Example.COM')).toBe('foobar@mail.example.com')
  })

  it('rejects empty local-part', () => {
    expect(() => normalizeAddress('', 'example.com')).toThrow(/invalid/i)
    expect(() => normalizeAddress('@example.com', 'example.com')).toThrow(/invalid/i)
  })
})

describe('default uniqueness', () => {
  it('patchAlias isDefault=true clears previous default via D1 batch', async () => {
    const existing = {
      id: 'a2',
      address: 'a2@example.com',
      enabled: 1,
      is_default: 0,
      created_at: 100,
    }
    const stmts: string[] = []
    const first = vi.fn().mockResolvedValue(existing)
    const run = vi.fn().mockResolvedValue({ success: true })
    const bind = vi.fn().mockReturnValue({ first, run })
    const prepare = vi.fn((sql: string) => {
      stmts.push(sql)
      return { bind, first, run }
    })
    const batch = vi.fn(async (ops: unknown[]) => {
      // Capture SQL from statements already prepared into the batch
      return ops
    })
    const db = { prepare, batch } as unknown as D1Database

    const updated = await patchAlias(db, 'a2', { isDefault: true })

    expect(updated).toMatchObject({ id: 'a2', isDefault: true, enabled: true })
    expect(batch).toHaveBeenCalledTimes(1)
    const batchArgs = batch.mock.calls[0]?.[0] as unknown[]
    expect(batchArgs).toHaveLength(2)
    // First statement clears all defaults; second sets target as default
    expect(stmts[1]).toMatch(/UPDATE\s+aliases\s+SET\s+is_default\s*=\s*0\s+WHERE\s+is_default\s*=\s*1/i)
    expect(stmts[2]).toMatch(/UPDATE\s+aliases\s+SET\s+enabled\s*=\s*\?\s*,\s*is_default\s*=\s*1\s+WHERE\s+id\s*=\s*\?/i)
    expect(bind).toHaveBeenCalledWith(1, 'a2')
  })

  it('first created alias auto-defaults when none exist', () => {
    expect(shouldAutoDefaultOnCreate(0, false)).toBe(true)
    expect(shouldAutoDefaultOnCreate(2, false)).toBe(true)
    expect(shouldAutoDefaultOnCreate(2, true)).toBe(false)
  })
})
