import type { Env } from '../../env'
import { createCloudflareSendAdapter } from './cloudflare'
import { createMailchannelsSendAdapter } from './mailchannels'
import { createResendSendAdapter } from './resend'
import type { SendAdapter } from './types'

export type { SendAdapter, SendErrorCode, SendInput, SendResult } from './types'
export { isSendError } from './types'

export function getSendAdapter(env: Env): SendAdapter {
  switch (env.SEND_CHANNEL) {
    case 'resend':
      return createResendSendAdapter(env)
    case 'mailchannels':
      return createMailchannelsSendAdapter(env)
    case 'cloudflare':
    default:
      return createCloudflareSendAdapter(env)
  }
}
