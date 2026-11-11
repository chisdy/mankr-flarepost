import type { Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
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
    let body: { address?: unknown; localPart?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    if (
      !body ||
      typeof body !== 'object' ||
      'address' in body === 'localPart' in body
    ) {
      return jsonError(c, 400, 'invalid_body')
    }
    if (
      'localPart' in body &&
      (typeof body.localPart !== 'string' ||
        !/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/i.test(
          body.localPart.trim(),
        ) ||
        body.localPart.includes('..'))
    ) {
      return jsonError(c, 400, 'invalid_address')
    }
    const address =
      typeof body.localPart === 'string'
        ? body.localPart
        : typeof body.address === 'string'
          ? body.address
          : ''
    if (!address.trim()) {
      return jsonError(c, 400, 'invalid_address')
    }

    try {
      const created = await createAlias(c.env.DB, {
        address,
        domain: c.env.EMAIL_DOMAIN,
      })
      return c.json(created, 201)
    } catch (e) {
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
