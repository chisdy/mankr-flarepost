import { createMiddleware } from 'hono/factory'
import type { Env } from '../env'
import { findApiKeyByHash, hashApiKey, parseBearerToken } from '../api-keys/service'
import type { ApiKeyWithAlias } from '../api-keys/service'
import { readSession } from '../auth/session'
import { jsonError } from './errors'

export type AppVariables = {
  userId: string
  apiKey?: ApiKeyWithAlias
}

export const requireSession = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const session = await readSession(c.req.header('Cookie') ?? null, c.env.COOKIES_SECRET)
    if (!session) {
      return jsonError(c, 401, 'unauthorized')
    }
    c.set('userId', session.userId)
    await next()
  },
)

/**
 * Bearer-token auth for the public send API. A missing key, a disabled key and
 * a disabled sender alias all return the same 401 so keys cannot be enumerated.
 */
export const requireApiKey = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const token = parseBearerToken(c.req.header('Authorization'))
    if (!token) {
      return c.json({ error: 'unauthorized', message: 'Missing or invalid API key.' }, 401)
    }

    const apiKey = await findApiKeyByHash(c.env.DB, await hashApiKey(token))
    if (!apiKey || !apiKey.enabled || !apiKey.aliasEnabled) {
      return c.json({ error: 'unauthorized', message: 'Missing or invalid API key.' }, 401)
    }

    c.set('apiKey', apiKey)
    await next()
  },
)
