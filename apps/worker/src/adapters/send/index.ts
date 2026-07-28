import type { Env } from '../../env'
import { createBrevoSendAdapter } from './brevo'
import { createMailerooSendAdapter } from './maileroo'
import { createResendSendAdapter } from './resend'
import { resolveSendConfig } from './resolve'
import type { SendAdapter, SendProviderId } from './types'

export type {
  ActiveProviderSource,
  ApiKeySource,
  ResolvedSendConfig,
} from './resolve'
export {
  DEFAULT_PROVIDER,
  envApiKey,
  envVarNameForProvider,
  isProviderCredentialConfigured,
  resolveSendConfig,
} from './resolve'
export type {
  ProviderQuotaReading,
  SendAdapter,
  SendErrorCode,
  SendInput,
  SendProviderId,
  SendResult,
  SendSuccess,
} from './types'
export { isSendError, isSendProviderId, SEND_PROVIDER_IDS } from './types'

function createAdapter(provider: SendProviderId, apiKey: string): SendAdapter {
  switch (provider) {
    case 'resend':
      return createResendSendAdapter(apiKey)
    case 'brevo':
      return createBrevoSendAdapter(apiKey)
    case 'maileroo':
      return createMailerooSendAdapter(apiKey)
  }
}

/**
 * Picks the active outbound channel (DB → env → default resend) and its API key
 * (DB sealed secret → env). Always returns an adapter; empty key yields not_configured.
 */
export async function getSendAdapter(env: Env): Promise<SendAdapter> {
  const config = await resolveSendConfig(env)
  return createAdapter(config.provider, config.apiKey)
}
