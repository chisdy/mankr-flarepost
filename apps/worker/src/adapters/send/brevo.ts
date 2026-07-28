import type { SendAdapter, SendInput, SendResult } from './types'

/**
 * Brevo transactional email API.
 * @see https://developers.brevo.com/reference/sendtransacemail
 */
export function createBrevoSendAdapter(apiKey: string): SendAdapter {
  return {
    provider: 'brevo',
    async send(input: SendInput): Promise<SendResult> {
      const key = apiKey.trim()
      if (!key) {
        return { error: 'not_configured' }
      }

      const payload: Record<string, unknown> = {
        sender: { email: input.from },
        to: input.to.map((email) => ({ email })),
        subject: input.subject,
        textContent: input.text,
      }
      if (input.html !== undefined) payload.htmlContent = input.html
      if (input.replyTo !== undefined) payload.replyTo = { email: input.replyTo }

      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': key,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (res.status === 400 || res.status === 422) {
          return { error: 'invalid_address' }
        }
        if (!res.ok) {
          return { error: 'provider_error' }
        }

        const data = (await res.json().catch(() => ({}))) as { messageId?: string }
        return { id: data.messageId }
      } catch {
        return { error: 'provider_error' }
      }
    },
  }
}
