import type {
  ProviderQuotaReading,
  SendAdapter,
  SendInput,
  SendResult,
} from './types'

/**
 * Resend reports quota only on a response that actually consumed some, so a successful send
 * is the sole place these headers appear. There is no usage endpoint to poll instead, and
 * reading them costs nothing here.
 */
function readQuotaHeaders(res: Response): ProviderQuotaReading | undefined {
  const daily = parseHeaderCount(res.headers.get('x-resend-daily-quota'))
  // Only free plans get the daily header, so a missing one is normal on paid plans.
  const monthly = parseHeaderCount(res.headers.get('x-resend-monthly-quota'))
  if (daily === null && monthly === null) return undefined
  return { dailyUsed: daily, monthlyUsed: monthly }
}

function parseHeaderCount(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw.trim())
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function createResendSendAdapter(env: { RESEND_API_KEY?: string }): SendAdapter {
  return {
    provider: 'resend',
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

        const quota = readQuotaHeaders(res)
        const data = (await res.json().catch(() => ({}))) as { id?: string }
        return quota ? { id: data.id, quota } : { id: data.id }
      } catch {
        return { error: 'provider_error' }
      }
    },
  }
}
