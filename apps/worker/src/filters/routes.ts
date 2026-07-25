import type { Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  InvalidFilterError,
  createFilter,
  deleteFilter,
  listFilters,
  updateFilter,
  validateFilterPayload,
} from './service'

type FilterApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerFilterRoutes(app: FilterApp): void {
  app.get('/api/filters', async (c) => {
    const filters = await listFilters(c.env.DB)
    return c.json({ filters })
  })

  app.post('/api/filters', async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    try {
      const input = validateFilterPayload(body)
      const created = await createFilter(c.env.DB, input)
      return c.json(created, 201)
    } catch (e) {
      if (e instanceof InvalidFilterError) return jsonError(c, 400, e.code)
      throw e
    }
  })

  app.patch('/api/filters/:id', async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    try {
      const input = validateFilterPayload(body)
      const updated = await updateFilter(c.env.DB, c.req.param('id'), input)
      if (!updated) return jsonError(c, 404, 'not_found')
      return c.json(updated)
    } catch (e) {
      if (e instanceof InvalidFilterError) return jsonError(c, 400, e.code)
      throw e
    }
  })

  app.delete('/api/filters/:id', async (c) => {
    const ok = await deleteFilter(c.env.DB, c.req.param('id'))
    if (!ok) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true })
  })
}
