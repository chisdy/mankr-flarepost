import type { Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  InvalidCursorError,
  emptyTrash,
  getMessage,
  isFolder,
  listMessages,
  markRead,
  moveToTrash,
  restoreMessage,
} from './service'

type MessageApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerMessageRoutes(app: MessageApp): void {
  app.get('/api/messages', async (c) => {
    const folderRaw = c.req.query('folder') ?? 'inbox'
    if (!isFolder(folderRaw)) {
      return jsonError(c, 400, 'invalid_folder')
    }

    const limitRaw = c.req.query('limit')
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined
    const cursor = c.req.query('cursor') ?? null

    try {
      const result = await listMessages(c.env.DB, {
        folder: folderRaw,
        limit,
        cursor,
      })
      return c.json(result)
    } catch (e) {
      if (e instanceof InvalidCursorError) {
        return jsonError(c, 400, e.code)
      }
      throw e
    }
  })

  // Physical delete all trash — register before :id routes for clarity
  app.delete('/api/messages/trash', async (c) => {
    const deleted = await emptyTrash(c.env.DB)
    return c.json({ deleted })
  })

  app.get('/api/messages/:id', async (c) => {
    const msg = await getMessage(c.env.DB, c.req.param('id'))
    if (!msg) return jsonError(c, 404, 'not_found')
    return c.json(msg)
  })

  app.post('/api/messages/:id/read', async (c) => {
    const ok = await markRead(c.env.DB, c.req.param('id'))
    if (!ok) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true })
  })

  app.post('/api/messages/:id/trash', async (c) => {
    const ok = await moveToTrash(c.env.DB, c.req.param('id'))
    if (!ok) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true })
  })

  app.post('/api/messages/:id/restore', async (c) => {
    const restored = await restoreMessage(c.env.DB, c.req.param('id'))
    if (!restored) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true, folder: restored.folder })
  })
}
