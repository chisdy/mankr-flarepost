import type { Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  ApiKeyLimitError,
  EMPTY_USAGE,
  InvalidApiKeyInputError,
  createApiKey,
  deleteApiKey,
  getUsageByKey,
  listApiKeys,
  patchApiKey,
  type ApiKeyUsage,
  type ApiKeyWithAlias,
} from './service'

type ApiKeyApp = Hono<{ Bindings: Env; Variables: AppVariables }>

function toPublicKey(key: ApiKeyWithAlias, usage: ApiKeyUsage = EMPTY_USAGE) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    aliasId: key.aliasId,
    aliasAddress: key.aliasAddress,
    aliasEnabled: key.aliasEnabled,
    enabled: key.enabled,
    hourlyLimit: key.hourlyLimit,
    dailyLimit: key.dailyLimit,
    createdAt: key.createdAt,
    usage,
  }
}

export function registerApiKeyRoutes(app: ApiKeyApp): void {
  app.get('/api/api-keys', async (c) => {
    const [keys, usageByKey] = await Promise.all([
      listApiKeys(c.env.DB),
      getUsageByKey(c.env.DB),
    ])
    return c.json({
      apiKeys: keys.map((key) => toPublicKey(key, usageByKey.get(key.id) ?? EMPTY_USAGE)),
    })
  })

  app.post('/api/api-keys', async (c) => {
    let body: {
      name?: unknown
      aliasId?: unknown
      hourlyLimit?: unknown
      dailyLimit?: unknown
    }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    if (typeof body.name !== 'string' || typeof body.aliasId !== 'string') {
      return jsonError(c, 400, 'invalid_body')
    }

    try {
      const created = await createApiKey(c.env.DB, {
        name: body.name,
        aliasId: body.aliasId,
        hourlyLimit: typeof body.hourlyLimit === 'number' ? body.hourlyLimit : undefined,
        dailyLimit: typeof body.dailyLimit === 'number' ? body.dailyLimit : undefined,
      })
      return c.json(
        {
          ...toPublicKey(created.apiKey),
          secret: created.secret,
        },
        201,
      )
    } catch (e) {
      if (e instanceof ApiKeyLimitError) {
        return c.json({ error: e.code, message: e.message }, 400)
      }
      if (e instanceof InvalidApiKeyInputError) {
        return c.json({ error: e.code, message: e.message }, 400)
      }
      throw e
    }
  })

  app.patch('/api/api-keys/:id', async (c) => {
    let body: {
      name?: unknown
      enabled?: unknown
      hourlyLimit?: unknown
      dailyLimit?: unknown
    }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const patch: {
      name?: string
      enabled?: boolean
      hourlyLimit?: number
      dailyLimit?: number
    } = {}
    if (typeof body.name === 'string') patch.name = body.name
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.hourlyLimit === 'number') patch.hourlyLimit = body.hourlyLimit
    if (typeof body.dailyLimit === 'number') patch.dailyLimit = body.dailyLimit

    if (
      patch.name === undefined &&
      patch.enabled === undefined &&
      patch.hourlyLimit === undefined &&
      patch.dailyLimit === undefined
    ) {
      return jsonError(c, 400, 'invalid_body')
    }

    try {
      const updated = await patchApiKey(c.env.DB, c.req.param('id'), patch)
      if (!updated) return jsonError(c, 404, 'not_found')
      const usage = (await getUsageByKey(c.env.DB)).get(updated.id) ?? EMPTY_USAGE
      return c.json(toPublicKey(updated, usage))
    } catch (e) {
      if (e instanceof InvalidApiKeyInputError) {
        return c.json({ error: e.code, message: e.message }, 400)
      }
      throw e
    }
  })

  app.delete('/api/api-keys/:id', async (c) => {
    const deleted = await deleteApiKey(c.env.DB, c.req.param('id'))
    if (!deleted) return jsonError(c, 404, 'not_found')
    return c.body(null, 204)
  })
}
