import type { SendAdapter, SendInput, SendResult } from './types'

export function createResendSendAdapter(env: { RESEND_API_KEY?: string }): SendAdapter {
  return {
    async send(input: SendInput): Promise<SendResult> {
      const apiKey = env.RESEND_API_KEY?.trim()
      if (!apiKey) {
        return { error: 'not_configured' }
      }

      const payload: Record<string, unknown> = {
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      }
      if (input.html !== undefined) payload.html = input.html
      if (input.replyTo !== undefined) payload.reply_to = input.replyTo
      if (input.attachments && input.attachments.length > 0) {
        payload.attachments = input.attachments.map((a) => ({
          filename: a.filename,
          content: a.contentBase64,
          content_type: a.contentType,
        }))
      }

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (res.status === 422 || res.status === 400) {
          return { error: 'invalid_address' }
        }
        if (!res.ok) {
          return { error: 'provider_error' }
        }

        const data = (await res.json().catch(() => ({}))) as { id?: string }
        return { id: data.id }
      } catch {
        return { error: 'provider_error' }
      }
    },
  }
}
