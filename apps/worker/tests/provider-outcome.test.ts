import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResendSendAdapter } from '../src/adapters/send/resend'
import { createBrevoSendAdapter } from '../src/adapters/send/brevo'
import { createMailerooSendAdapter } from '../src/adapters/send/maileroo'

afterEach(() => vi.unstubAllGlobals())
const input = {
  from: 'notify@example.com',
  to: ['recipient@example.com'],
  subject: 'Test',
  text: 'Test',
}

describe.each([
  ['resend', createResendSendAdapter],
  ['brevo', createBrevoSendAdapter],
  ['maileroo', createMailerooSendAdapter],
] as const)('%s outcome reporting', (_name, create) => {
  it('keeps legacy failures unchanged but marks ambiguous network failures for public sends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network disconnected')),
    )
    const adapter = create('mock')
    await expect(adapter.send(input)).resolves.toEqual({
      error: 'provider_error',
    })
    await expect(
      adapter.send({ ...input, trackOutcome: true }),
    ).resolves.toEqual({ error: 'provider_error', outcome: 'unknown' })
  })
  it('distinguishes a rejection from a server failure without changing missing-configuration errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () => new Response('{}', { status: 429 })),
    )
    await expect(
      create('mock').send({ ...input, trackOutcome: true }),
    ).resolves.toEqual({ error: 'provider_error', outcome: 'rejected' })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () => new Response('{}', { status: 503 })),
    )
    await expect(
      create('mock').send({ ...input, trackOutcome: true }),
    ).resolves.toEqual({ error: 'provider_error', outcome: 'unknown' })
    await expect(
      create('').send({ ...input, trackOutcome: true }),
    ).resolves.toEqual({ error: 'not_configured' })
  })
})
