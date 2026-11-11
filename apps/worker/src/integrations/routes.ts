import type { Hono } from 'hono'
import { countAliases } from '../aliases/service'
import { MAX_API_KEYS, countApiKeys } from '../api-keys/service'
import { resolveSendConfig } from '../adapters/send'
import type { Env } from '../env'
import type { AppVariables } from '../http/middleware'

export function registerIntegrationRoutes(
  app: Hono<{ Bindings: Env; Variables: AppVariables }>,
) {
  app.get('/api/integration-capabilities', async (c) => {
    const [addresses, keys, send] = await Promise.all([
      countAliases(c.env.DB),
      countApiKeys(c.env.DB),
      resolveSendConfig(c.env),
    ])
    return c.json({
      domain: c.env.EMAIL_DOMAIN?.trim().toLowerCase() || null,
      aliases: {
        limit: null,
        used: addresses,
        remaining: null,
      },
      apiKeys: {
        limit: MAX_API_KEYS,
        used: keys,
        remaining: Math.max(0, MAX_API_KEYS - keys),
      },
      outbound: {
        provider: send.provider,
        configured: Boolean(send.apiKey),
        domainVerified: null,
      },
      inbound: { status: 'unverified' },
      smtp: { mode: 'unconfigured' },
    })
  })
}
