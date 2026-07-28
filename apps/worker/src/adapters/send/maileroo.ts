import type { SendAdapter, SendInput, SendResult } from './types'

/**
 * Maileroo JSON email API.
 * @see https://maileroo.com/free-email-api
 */
export function createMailerooSendAdapter(apiKey: string): SendAdapter {
  return {
    provider: 'maileroo',
    async send(input: SendInput): Promise<SendResult> {
      const key = apiKey.trim()
      if (!key) {
        return { error: 'not_configured' }
      }

      const payload: Record<string, unknown> = {
        from: { address: input.from },
        to: input.to.map((address) => ({ address })),
        subject: input.subject,
        plain: input.text,
      }
      if (input.html !== undefined) payload.html = input.html
      if (input.replyTo !== undefined) {
        payload.reply_to = { address: input.replyTo }
      }

      try {
        const res = await fetch('https://smtp.maileroo.com/api/v2/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (res.status === 400 || res.status === 422) {
          return { error: 'invalid_address' }
        }
        if (!res.ok) {
          return { error: 'provider_error' }
        }

        const data = (await res.json().catch(() => ({}))) as {
          data?: { reference_id?: string }
          reference_id?: string
        }
        const id = data.data?.reference_id ?? data.reference_id
        return { id }
      } catch {
        return { error: 'provider_error' }
      }
    },
  }
}
