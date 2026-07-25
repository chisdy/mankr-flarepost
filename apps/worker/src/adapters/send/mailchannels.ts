import type { SendAdapter, SendInput, SendResult } from './types'

/**
 * MailChannels Email API (authenticated). Free Workers path EOL 2024-06-30;
 * requires MAILCHANNELS_API_KEY + Domain Lockdown.
 */
export function createMailchannelsSendAdapter(env: {
  MAILCHANNELS_API_KEY?: string
}): SendAdapter {
  return {
    async send(input: SendInput): Promise<SendResult> {
      const apiKey = env.MAILCHANNELS_API_KEY?.trim()
      if (!apiKey) {
        return { error: 'not_configured' }
      }

      const content: { type: string; value: string }[] = [
        { type: 'text/plain', value: input.text },
      ]
      if (input.html) {
        content.push({ type: 'text/html', value: input.html })
      }

      const body: Record<string, unknown> = {
        personalizations: [
          {
            to: input.to.map((email) => ({ email })),
          },
        ],
        from: { email: input.from },
        subject: input.subject,
        content,
      }
      if (input.replyTo) {
        body.reply_to = { email: input.replyTo }
      }

      try {
        const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
          },
          body: JSON.stringify(body),
        })

        if (res.status === 400 || res.status === 422) {
          return { error: 'invalid_address' }
        }
        if (!res.ok) {
          return { error: 'provider_error' }
        }

        // 202 Accepted often has empty body
        const data = (await res.json().catch(() => ({}))) as { id?: string }
        return data.id ? { id: data.id } : {}
      } catch {
        return { error: 'provider_error' }
      }
    },
  }
}
