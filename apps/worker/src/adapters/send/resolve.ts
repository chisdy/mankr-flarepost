import { open } from '../../crypto/secret-box'
import type { Env } from '../../env'
import { isSendProviderId, type SendProviderId } from './types'

export type ActiveProviderSource = 'database' | 'env' | 'default'
export type ApiKeySource = 'database' | 'env' | 'none'

export type ResolvedSendConfig = {
  provider: SendProviderId
  activeSource: ActiveProviderSource
  apiKey: string
  apiKeySource: ApiKeySource
}

const DEFAULT_PROVIDER: SendProviderId = 'resend'

function envApiKey(env: Env, provider: SendProviderId): string {
  switch (provider) {
    case 'resend':
      return env.RESEND_API_KEY?.trim() ?? ''
    case 'brevo':
      return env.BREVO_API_KEY?.trim() ?? ''
    case 'maileroo':
      return env.MAILEROO_API_KEY?.trim() ?? ''
  }
}

async function readActiveProviderFromDb(
  db: D1Database,
): Promise<SendProviderId | null> {
  const row = await db
    .prepare('SELECT send_provider FROM mailbox_settings WHERE id = 1')
    .first<{ send_provider: string | null }>()
  if (!row || row.send_provider == null) return null
  return isSendProviderId(row.send_provider) ? row.send_provider : null
}

async function readSecretFromDb(
  db: D1Database,
  provider: SendProviderId,
  cookiesSecret: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      'SELECT ciphertext, iv FROM send_provider_secrets WHERE provider = ?',
    )
    .bind(provider)
    .first<{ ciphertext: string; iv: string }>()
  if (!row) return null
  return open({ ciphertext: row.ciphertext, iv: row.iv }, cookiesSecret)
}

/**
 * Resolves which outbound provider to use and which API key to hand it.
 * Priority: database → env → defaults. Decrypt failures are treated as "no DB key".
 */
export async function resolveSendConfig(env: Env): Promise<ResolvedSendConfig> {
  const fromDb = await readActiveProviderFromDb(env.DB)
  let provider: SendProviderId
  let activeSource: ActiveProviderSource

  if (fromDb) {
    provider = fromDb
    activeSource = 'database'
  } else if (isSendProviderId(env.SEND_PROVIDER?.trim())) {
    provider = env.SEND_PROVIDER.trim() as SendProviderId
    activeSource = 'env'
  } else {
    provider = DEFAULT_PROVIDER
    activeSource = 'default'
  }

  const fromSecret = await readSecretFromDb(env.DB, provider, env.COOKIES_SECRET)
  if (fromSecret?.trim()) {
    return {
      provider,
      activeSource,
      apiKey: fromSecret.trim(),
      apiKeySource: 'database',
    }
  }

  const fromEnv = envApiKey(env, provider)
  if (fromEnv) {
    return {
      provider,
      activeSource,
      apiKey: fromEnv,
      apiKeySource: 'env',
    }
  }

  return {
    provider,
    activeSource,
    apiKey: '',
    apiKeySource: 'none',
  }
}

/** True when this provider has a usable key in DB (decryptable) or env. */
export async function isProviderCredentialConfigured(
  env: Env,
  provider: SendProviderId,
): Promise<boolean> {
  const fromSecret = await readSecretFromDb(env.DB, provider, env.COOKIES_SECRET)
  if (fromSecret?.trim()) return true
  return Boolean(envApiKey(env, provider))
}

export function envVarNameForProvider(provider: SendProviderId): string {
  switch (provider) {
    case 'resend':
      return 'RESEND_API_KEY'
    case 'brevo':
      return 'BREVO_API_KEY'
    case 'maileroo':
      return 'MAILEROO_API_KEY'
  }
}

export { envApiKey, DEFAULT_PROVIDER }
