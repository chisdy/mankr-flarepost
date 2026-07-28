import { describe, expect, it } from 'vitest'
import { keyHint, open, seal } from '../src/crypto/secret-box'

describe('secret-box', () => {
  it('round-trips plaintext', async () => {
    const sealed = await seal('re_secret_value', 'cookies-secret')
    expect(sealed.ciphertext).toBeTruthy()
    expect(sealed.iv).toBeTruthy()
    await expect(open(sealed, 'cookies-secret')).resolves.toBe('re_secret_value')
  })

  it('returns null when COOKIES_SECRET changes', async () => {
    const sealed = await seal('re_secret_value', 'cookies-secret')
    await expect(open(sealed, 'rotated-secret')).resolves.toBeNull()
  })

  it('returns null for corrupt ciphertext', async () => {
    const sealed = await seal('re_secret_value', 'cookies-secret')
    await expect(
      open({ ...sealed, ciphertext: 'not-valid-base64!!!' }, 'cookies-secret'),
    ).resolves.toBeNull()
  })

  it('keyHint keeps at most the last four characters', () => {
    expect(keyHint('re_abcdefgh')).toBe('efgh')
    expect(keyHint('ab')).toBe('ab')
    expect(keyHint('  ')).toBe('')
  })
})
