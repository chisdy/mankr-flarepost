import type { Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  InvalidTagError,
  TagLimitError,
  createTag,
  deleteTag,
  listTags,
  messageExists,
  setMessageTags,
  updateTag,
} from './service'

type TagApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerTagRoutes(app: TagApp): void {
  app.get('/api/tags', async (c) => {
    const tags = await listTags(c.env.DB)
    return c.json({ tags })
  })

  app.post('/api/tags', async (c) => {
    let body: { name?: unknown; color?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    if (typeof body.name !== 'string') {
      return jsonError(c, 400, 'invalid_body')
    }

    try {
      const tag = await createTag(c.env.DB, {
        name: body.name,
        color: typeof body.color === 'string' || body.color === null ? body.color : undefined,
      })
      return c.json(tag, 201)
    } catch (e) {
      if (e instanceof TagLimitError) return jsonError(c, 400, e.code)
      if (e instanceof InvalidTagError) return jsonError(c, 400, e.code)
      throw e
    }
  })

  app.patch('/api/tags/:id', async (c) => {
    let body: { name?: unknown; color?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const patch: { name?: string; color?: string | null } = {}
    if ('name' in body) {
      if (typeof body.name !== 'string') return jsonError(c, 400, 'invalid_body')
      patch.name = body.name
    }
    if ('color' in body) {
      if (body.color !== null && typeof body.color !== 'string') {
        return jsonError(c, 400, 'invalid_body')
      }
      patch.color = body.color as string | null
    }

    try {
      const updated = await updateTag(c.env.DB, c.req.param('id'), patch)
      if (!updated) return jsonError(c, 404, 'not_found')
      return c.json(updated)
    } catch (e) {
      if (e instanceof InvalidTagError) return jsonError(c, 400, e.code)
      throw e
    }
  })

  app.delete('/api/tags/:id', async (c) => {
    const ok = await deleteTag(c.env.DB, c.req.param('id'))
    if (!ok) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true })
  })

  app.put('/api/messages/:id/tags', async (c) => {
    let body: { tagIds?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    if (!Array.isArray(body.tagIds) || !body.tagIds.every((x) => typeof x === 'string')) {
      return jsonError(c, 400, 'invalid_body')
    }

    const id = c.req.param('id')
    if (!(await messageExists(c.env.DB, id))) {
      return jsonError(c, 404, 'not_found')
    }

    const tagIds = await setMessageTags(c.env.DB, id, body.tagIds)
    return c.json({ tagIds })
  })
}
