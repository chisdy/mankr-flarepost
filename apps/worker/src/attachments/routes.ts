import type { Context, Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import { getMessage } from '../messages/service'
import {
  AttachmentLimitError,
  deleteAttachment,
  getAttachment,
  listAttachmentsForMessage,
  MAX_ATTACHMENT_BYTES,
  storeAttachment,
  toUint8Array,
} from './service'

type AttEnv = { Bindings: Env; Variables: AppVariables }
type AttApp = Hono<AttEnv>
type AttContext = Context<AttEnv>

function requireR2(c: AttContext): R2Bucket | Response {
  if (!c.env.ATTACHMENTS) {
    return jsonError(c, 503, 'attachments_unavailable')
  }
  return c.env.ATTACHMENTS
}

export function registerAttachmentRoutes(app: AttApp): void {
  app.post('/api/attachments', async (c) => {
    const r2 = requireR2(c)
    if (r2 instanceof Response) return r2

    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return jsonError(c, 400, 'invalid_body')
    }

    const messageIdRaw = form.get('messageId')
    const messageId =
      typeof messageIdRaw === 'string' && messageIdRaw.trim()
        ? messageIdRaw.trim()
        : null

    if (messageId) {
      const msg = await getMessage(c.env.DB, messageId)
      if (!msg || msg.folder !== 'draft') {
        return jsonError(c, 400, 'invalid_message')
      }
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return jsonError(c, 400, 'attachment_too_large')
    }

    const buf = await file.arrayBuffer()
    try {
      const meta = await storeAttachment(c.env.DB, r2, {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        bytes: toUint8Array(buf),
        messageId,
      })
      return c.json(meta, 201)
    } catch (e) {
      if (e instanceof AttachmentLimitError) {
        return jsonError(c, 400, e.code)
      }
      throw e
    }
  })

  app.get('/api/messages/:id/attachments', async (c) => {
    const msg = await getMessage(c.env.DB, c.req.param('id'))
    if (!msg) return jsonError(c, 404, 'not_found')
    const items = await listAttachmentsForMessage(c.env.DB, msg.id)
    return c.json({ items })
  })

  app.get('/api/attachments/:id', async (c) => {
    const r2 = requireR2(c)
    if (r2 instanceof Response) return r2

    const row = await getAttachment(c.env.DB, c.req.param('id'))
    if (!row) return jsonError(c, 404, 'not_found')

    const obj = await r2.get(row.r2_key)
    if (!obj) return jsonError(c, 404, 'not_found')

    const headers = new Headers()
    headers.set('Content-Type', row.content_type)
    headers.set('Content-Length', String(row.size_bytes))
    headers.set(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    )
    headers.set('Cache-Control', 'private, max-age=3600')

    return new Response(obj.body, { status: 200, headers })
  })

  app.delete('/api/attachments/:id', async (c) => {
    const r2 = requireR2(c)
    if (r2 instanceof Response) return r2

    const ok = await deleteAttachment(c.env.DB, r2, c.req.param('id'))
    if (!ok) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true })
  })
}
