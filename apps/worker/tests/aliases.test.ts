import { describe, expect, it } from 'vitest'
import {
  MAX_ALIASES,
  AliasLimitError,
  assertCanCreate,
  normalizeAddress,
  applyDefaultUnique,
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

describe('assertCanCreate', () => {
  it('allows create when count < 5', () => {
    expect(() => assertCanCreate(0)).not.toThrow()
    expect(() => assertCanCreate(4)).not.toThrow()
  })

  it('rejects when count >= 5 with alias_limit', () => {
    expect(() => assertCanCreate(5)).toThrow(AliasLimitError)
    expect(() => assertCanCreate(6)).toThrow(AliasLimitError)
    try {
      assertCanCreate(MAX_ALIASES)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AliasLimitError)
      const err = e as AliasLimitError
      expect(err.code).toBe('alias_limit')
      expect(err.message).toMatch(/5/)
    }
  })
})

describe('default uniqueness', () => {
  it('setting isDefault=true clears previous default', () => {
    const aliases = [
      { id: 'a1', isDefault: true },
      { id: 'a2', isDefault: false },
      { id: 'a3', isDefault: false },
    ]
    expect(applyDefaultUnique(aliases, 'a2')).toEqual([
      { id: 'a1', isDefault: false },
      { id: 'a2', isDefault: true },
      { id: 'a3', isDefault: false },
    ])
  })

  it('first created alias auto-defaults when none exist', () => {
    expect(shouldAutoDefaultOnCreate(0, false)).toBe(true)
    expect(shouldAutoDefaultOnCreate(2, false)).toBe(true)
    expect(shouldAutoDefaultOnCreate(2, true)).toBe(false)
  })
})
