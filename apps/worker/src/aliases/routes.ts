import type { Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  AliasLimitError,
  InvalidAddressError,
  createAlias,
  listAliases,
  patchAlias,
} from './service'

type AliasApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerAliasRoutes(app: AliasApp): void {
  app.get('/api/aliases', async (c) => {
    const aliases = await listAliases(c.env.DB)
    return c.json({ aliases })
  })

  app.post('/api/aliases', async (c) => {
    let body: { address?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const address = typeof body.address === 'string' ? body.address : ''
    if (!address.trim()) {
      return jsonError(c, 400, 'invalid_address')
    }

    try {
      const created = await createAlias(c.env.DB, {
        address,
        domain: c.env.EMAIL_DOMAIN,
      })
      return c.json({ address: created.address }, 201)
    } catch (e) {
      if (e instanceof AliasLimitError) {
        return c.json({ error: e.code, message: e.message }, 400)
      }
      if (e instanceof InvalidAddressError) {
        return jsonError(c, 400, e.code)
      }
      throw e
    }
  })

  app.patch('/api/aliases/:id', async (c) => {
    let body: { enabled?: unknown; isDefault?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const patch: { enabled?: boolean; isDefault?: boolean } = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.isDefault === 'boolean') patch.isDefault = body.isDefault

    if (patch.enabled === undefined && patch.isDefault === undefined) {
      return jsonError(c, 400, 'invalid_body')
    }

    const updated = await patchAlias(c.env.DB, c.req.param('id'), patch)
    if (!updated) {
      return jsonError(c, 404, 'not_found')
    }
    return c.json({
      id: updated.id,
      address: updated.address,
      enabled: updated.enabled,
      isDefault: updated.isDefault,
      createdAt: updated.createdAt,
    })
  })
}
