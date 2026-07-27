export type SendErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'invalid_address'
  | 'provider_error'

export type SendInput = {
  from: string
  to: string[]
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export type SendResult = { id?: string } | { error: SendErrorCode }

export interface SendAdapter {
  send(input: SendInput): Promise<SendResult>
}

export function isSendError(
  result: SendResult,
): result is { error: SendErrorCode } {
  return 'error' in result
}
