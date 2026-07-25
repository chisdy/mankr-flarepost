export type SendErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'invalid_address'
  | 'provider_error'
  | 'attachments_unsupported'

export type SendAttachment = {
  filename: string
  contentType: string
  contentBase64: string
}

export type SendInput = {
  from: string
  to: string[]
  subject: string
  text: string
  html?: string
  replyTo?: string
  attachments?: SendAttachment[]
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
