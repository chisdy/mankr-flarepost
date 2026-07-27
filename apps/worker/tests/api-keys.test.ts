import { describe, expect, it } from 'vitest'
import {
  KEY_PREFIX,
  apiKeyPrefixOf,
  generateApiKeySecret,
  hashApiKey,
  normalizeKeyName,
  normalizeLimit,
  parseBearerToken,
  InvalidApiKeyInputError,
} from '../src/api-keys/service'
import {
  WINDOW_MS,
  evaluateQuota,
  windowStartFor,
} from '../src/api-keys/quota'

describe('generateApiKeySecret', () => {
  it('uses mfp_live_ prefix and enough entropy', () => {
    const secret = generateApiKeySecret()
    expect(secret.startsWith(KEY_PREFIX)).toBe(true)
    expect(secret.length).toBeGreaterThan(KEY_PREFIX.length + 40)
  })

  it('produces unique values', () => {
    const a = generateApiKeySecret()
    const b = generateApiKeySecret()
    expect(a).not.toBe(b)
  })
})

describe('hashApiKey', () => {
  it('is stable and hex-encoded', async () => {
    const hash = await hashApiKey('mfp_live_test')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    await expect(hashApiKey('mfp_live_test')).resolves.toBe(hash)
    await expect(hashApiKey('mfp_live_other')).resolves.not.toBe(hash)
  })
})

describe('apiKeyPrefixOf', () => {
  it('keeps the fixed prefix plus 8 random chars', () => {
    const secret = `${KEY_PREFIX}abcdefghijklmnop`
    expect(apiKeyPrefixOf(secret)).toBe(`${KEY_PREFIX}abcdefgh`)
  })
})

describe('parseBearerToken', () => {
  it('extracts the token', () => {
    expect(parseBearerToken('Bearer mfp_live_abc')).toBe('mfp_live_abc')
    expect(parseBearerToken('bearer mfp_live_abc')).toBe('mfp_live_abc')
  })

  it('rejects missing or malformed headers', () => {
    expect(parseBearerToken(null)).toBeNull()
    expect(parseBearerToken('')).toBeNull()
    expect(parseBearerToken('Basic abc')).toBeNull()
    expect(parseBearerToken('Bearer')).toBeNull()
  })
})

describe('normalize helpers', () => {
  it('trims and caps names', () => {
    expect(normalizeKeyName('  shop  ')).toBe('shop')
    expect(normalizeKeyName('x'.repeat(100)).length).toBe(60)
  })

  it('validates integer limits', () => {
    expect(normalizeLimit(undefined, 30)).toBe(30)
    expect(normalizeLimit(10, 30)).toBe(10)
    expect(() => normalizeLimit(1.5, 30)).toThrow(InvalidApiKeyInputError)
    expect(() => normalizeLimit(0, 30)).toThrow(InvalidApiKeyInputError)
    expect(() => normalizeLimit(20_000, 30)).toThrow(InvalidApiKeyInputError)
  })
})

describe('quota windows', () => {
  it('aligns window starts to the hour', () => {
    expect(windowStartFor(1_700_000_123_456)).toBe(
      Math.floor(1_700_000_123_456 / WINDOW_MS) * WINDOW_MS,
    )
  })

  it('blocks when the hourly limit is reached', () => {
    expect(evaluateQuota({ hourCount: 30, dayCount: 30 }, { hourlyLimit: 30, dailyLimit: 200 })).toEqual({
      ok: false,
      error: 'quota_exceeded',
      scope: 'hour',
    })
  })

  it('blocks when the daily limit is reached', () => {
    expect(evaluateQuota({ hourCount: 5, dayCount: 200 }, { hourlyLimit: 30, dailyLimit: 200 })).toEqual({
      ok: false,
      error: 'quota_exceeded',
      scope: 'day',
    })
  })

  it('allows under both limits', () => {
    expect(evaluateQuota({ hourCount: 0, dayCount: 0 }, { hourlyLimit: 30, dailyLimit: 200 })).toEqual({
      ok: true,
    })
  })
})
