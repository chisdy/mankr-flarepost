import type { SendAdapter, SendInput, SendResult } from './types'

export type CloudflareEmailBinding = {
  send(msg: unknown): Promise<{ messageId?: string }>
}

function isInvalidAddressError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /invalid.*(address|destination|recipient)|unknown recipient|bad address/i.test(msg)
}

export function createCloudflareSendAdapter(env: {
  EMAIL?: CloudflareEmailBinding
}): SendAdapter {
  return {
    async send(input: SendInput): Promise<SendResult> {
      if (!env.EMAIL) {
        return { error: 'not_configured' }
      }
      try {
        const result = await env.EMAIL.send({
          from: input.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          replyTo: input.replyTo,
        })
        return { id: result?.messageId }
      } catch (err) {
        if (isInvalidAddressError(err)) {
          return { error: 'invalid_address' }
        }
        return { error: 'provider_error' }
      }
    },
  }
}
