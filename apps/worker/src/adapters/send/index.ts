import type { Env } from '../../env'
import { createResendSendAdapter } from './resend'
import type { SendAdapter } from './types'

export type { SendAdapter, SendErrorCode, SendInput, SendResult } from './types'
export { isSendError } from './types'

/**
 * Resend is the only outbound channel: it is the one path that sends to arbitrary
 * recipients on a free tier without a credit card. Cloudflare Email Sending needs
 * Workers Paid for that, and MailChannels' free Workers path was retired.
 */
export function getSendAdapter(env: Env): SendAdapter {
  return createResendSendAdapter(env)
}
