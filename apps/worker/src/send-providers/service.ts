import {
  DEFAULT_PROVIDER,
  envApiKey,
  envVarNameForProvider,
  isSendProviderId,
  resolveSendConfig,
  SEND_PROVIDER_IDS,
  type ActiveProviderSource,
  type ApiKeySource,
  type SendProviderId,
} from '../adapters/send'
import { keyHint, open, seal } from '../crypto/secret-box'
import type { Env } from '../env'

export type ProviderCredentialStatus = {
  provider: SendProviderId
  configured: boolean
  source: ApiKeySource
  hint: string | null
  envVar: string
}

export type SendProvidersSnapshot = {
  activeProvider: SendProviderId
  activeSource: ActiveProviderSource
  providers: ProviderCredentialStatus[]
}

export type UpdateSendProvidersInput = {
  /** `null` clears the DB override so env/default applies. `undefined` leaves it unchanged. */
  activeProvider?: SendProviderId | null
  secrets?: Array<{ provider: SendProviderId; apiKey: string }>
}

async function listSecretHints(
  db: D1Database,
): Promise<Map<SendProviderId, string | null>> {
  const result = await db
    .prepare('SELECT provider, key_hint FROM send_provider_secrets')
    .all<{ provider: string; key_hint: string | null }>()
  const map = new Map<SendProviderId, string | null>()
  for (const row of result.results ?? []) {
    if (isSendProviderId(row.provider)) {
      map.set(row.provider, row.key_hint)
    }
  }
  return map
}

async function hasDecryptableSecret(
  env: Env,
  provider: SendProviderId,
): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT ciphertext, iv FROM send_provider_secrets WHERE provider = ?',
  )
    .bind(provider)
    .first<{ ciphertext: string; iv: string }>()
  if (!row) return false
  const plain = await open(row, env.COOKIES_SECRET)
  return Boolean(plain?.trim())
}

export async function getSendProvidersSnapshot(
  env: Env,
): Promise<SendProvidersSnapshot> {
  const config = await resolveSendConfig(env)
  const hints = await listSecretHints(env.DB)

  const providers: ProviderCredentialStatus[] = []
  for (const provider of SEND_PROVIDER_IDS) {
    const envKey = envApiKey(env, provider)
    const dbOk = await hasDecryptableSecret(env, provider)
    let source: ApiKeySource = 'none'
    let configured = false
    let hint: string | null = null

    if (dbOk) {
      source = 'database'
      configured = true
      hint = hints.get(provider) ?? null
    } else if (envKey) {
      source = 'env'
      configured = true
    }

    providers.push({
      provider,
      configured,
      source,
      hint,
      envVar: envVarNameForProvider(provider),
    })
  }

  return {
    activeProvider: config.provider,
    activeSource: config.activeSource,
    providers,
  }
}

export async function updateSendProviders(
  env: Env,
  input: UpdateSendProvidersInput,
): Promise<SendProvidersSnapshot> {
  if (input.activeProvider !== undefined) {
    if (input.activeProvider === null) {
      await env.DB.prepare(
        `UPDATE mailbox_settings SET send_provider = NULL WHERE id = 1`,
      ).run()
    } else {
      await env.DB.prepare(
        `INSERT INTO mailbox_settings (id, trash_retention_days, spam_retention_days, send_provider)
         VALUES (1, 30, 30, ?)
         ON CONFLICT(id) DO UPDATE SET send_provider = excluded.send_provider`,
      )
        .bind(input.activeProvider)
        .run()
    }
  }

  if (input.secrets) {
    const now = Date.now()
    for (const entry of input.secrets) {
      if (!isSendProviderId(entry.provider)) continue
      const trimmed = entry.apiKey.trim()
      if (!trimmed) {
        await env.DB.prepare(
          'DELETE FROM send_provider_secrets WHERE provider = ?',
        )
          .bind(entry.provider)
          .run()
        continue
      }

      const sealed = await seal(trimmed, env.COOKIES_SECRET)
      await env.DB.prepare(
        `INSERT INTO send_provider_secrets (provider, ciphertext, iv, key_hint, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           key_hint = excluded.key_hint,
           updated_at = excluded.updated_at`,
      )
        .bind(entry.provider, sealed.ciphertext, sealed.iv, keyHint(trimmed), now)
        .run()
    }
  }

  return getSendProvidersSnapshot(env)
}

export { DEFAULT_PROVIDER, isSendProviderId, SEND_PROVIDER_IDS }
