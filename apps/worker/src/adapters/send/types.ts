export type SendErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'invalid_address'
  | 'provider_error'

/** Identifies which service sent a message, so usage can be attributed per provider. */
export type SendProviderId = 'resend' | 'brevo' | 'maileroo'

export const SEND_PROVIDER_IDS: readonly SendProviderId[] = [
  'resend',
  'brevo',
  'maileroo',
] as const

export function isSendProviderId(value: unknown): value is SendProviderId {
  return value === 'resend' || value === 'brevo' || value === 'maileroo'
}

/**
 * What the provider said about its own tally while accepting the message. A `null` window
 * means it reported nothing for that window, which is different from reporting zero.
 */
export type ProviderQuotaReading = {
  dailyUsed: number | null
  monthlyUsed: number | null
}

export type SendInput = {
  from: string
  to: string[]
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export type SendSuccess = {
  id?: string
  /** Absent when the provider volunteered no quota figures with this response. */
  quota?: ProviderQuotaReading
}

export type SendResult = SendSuccess | { error: SendErrorCode }

export interface SendAdapter {
  /** Which service this adapter speaks to; recorded against every send it makes. */
  readonly provider: SendProviderId
  send(input: SendInput): Promise<SendResult>
}

export function isSendError(
  result: SendResult,
): result is { error: SendErrorCode } {
  return 'error' in result
}
