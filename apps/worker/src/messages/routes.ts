import type { Context, Hono } from 'hono'
import { findAliasById } from '../aliases/service'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  InvalidCursorError,
  deleteDraft,
  emptyTrash,
  getMessage,
  insertDraft,
  isDraft,
  isFolder,
  listMessages,
  markRead,
  moveToTrash,
  restoreMessage,
  searchMessages,
  setStarred,
  updateDraft,
} from './service'

type MessageEnv = { Bindings: Env; Variables: AppVariables }
type MessageApp = Hono<MessageEnv>
type MessageContext = Context<MessageEnv>

type DraftBody = {
  fromAliasId?: unknown
  to?: unknown
  subject?: unknown
  text?: unknown
  html?: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseTo(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const addrs = value.filter((x): x is string => typeof x === 'string')
  if (addrs.length !== value.length) return null
  return addrs.map((a) => a.trim()).filter(Boolean)
}

type ParsedDraft = {
  fromAliasId: string
  fromAddr: string
  to: string[]
  subject: string
  text: string
  html: string | null
}

async function parseDraftBody(
  c: MessageContext,
): Promise<{ ok: true; data: ParsedDraft } | { ok: false; response: Response }> {
  let body: DraftBody
  try {
    body = (await c.req.json()) as DraftBody
  } catch {
    return { ok: false, response: jsonError(c, 400, 'invalid_body') }
  }

  if (!isNonEmptyString(body.fromAliasId)) {
    return { ok: false, response: jsonError(c, 400, 'invalid_body') }
  }
  const to = parseTo(body.to)
  if (to === null) {
    return { ok: false, response: jsonError(c, 400, 'invalid_body') }
  }
  if (typeof body.subject !== 'string' || typeof body.text !== 'string') {
    return { ok: false, response: jsonError(c, 400, 'invalid_body') }
  }

  const alias = await findAliasById(c.env.DB, body.fromAliasId.trim())
  if (!alias || !alias.enabled) {
    return { ok: false, response: jsonError(c, 400, 'invalid_alias') }
  }

  return {
    ok: true,
    data: {
      fromAliasId: alias.id,
      fromAddr: alias.address,
      to,
      subject: body.subject,
      text: body.text,
      html: typeof body.html === 'string' ? body.html : null,
    },
  }
}

export function registerMessageRoutes(app: MessageApp): void {
  app.get('/api/messages', async (c) => {
    const starredRaw = c.req.query('starred')
    const tagId = c.req.query('tagId')?.trim() || undefined
    const starred = starredRaw === '1' || starredRaw === 'true'

    if (starred && tagId) {
      return jsonError(c, 400, 'invalid_query')
    }

    const limitRaw = c.req.query('limit')
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined
    const cursor = c.req.query('cursor') ?? null

    try {
      if (starred) {
        const result = await listMessages(c.env.DB, { starred: true, limit, cursor })
        return c.json(result)
      }
      if (tagId) {
        const result = await listMessages(c.env.DB, { tagId, limit, cursor })
        return c.json(result)
      }

      const folderRaw = c.req.query('folder') ?? 'inbox'
      if (!isFolder(folderRaw)) {
        return jsonError(c, 400, 'invalid_folder')
      }

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

  app.get('/api/messages/search', async (c) => {
    const q = c.req.query('q') ?? ''
    const limitRaw = c.req.query('limit')
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined
    const cursor = c.req.query('cursor') ?? null

    try {
      const result = await searchMessages(c.env.DB, { query: q, limit, cursor })
      return c.json(result)
    } catch (e) {
      if (e instanceof InvalidCursorError) {
        return jsonError(c, 400, e.code)
      }
      throw e
    }
  })

  app.post('/api/messages/drafts', async (c) => {
    const parsed = await parseDraftBody(c)
    if (!parsed.ok) return parsed.response

    const stored = await insertDraft(c.env.DB, {
      aliasId: parsed.data.fromAliasId,
      fromAddr: parsed.data.fromAddr,
      toAddrs: parsed.data.to,
      subject: parsed.data.subject,
      textBody: parsed.data.text,
      htmlBody: parsed.data.html,
    })

    return c.json({ id: stored.id }, 201)
  })

  app.put('/api/messages/drafts/:id', async (c) => {
    const parsed = await parseDraftBody(c)
    if (!parsed.ok) return parsed.response

    const ok = await updateDraft(c.env.DB, c.req.param('id'), {
      aliasId: parsed.data.fromAliasId,
      fromAddr: parsed.data.fromAddr,
      toAddrs: parsed.data.to,
      subject: parsed.data.subject,
      textBody: parsed.data.text,
      htmlBody: parsed.data.html,
    })
    if (!ok) return jsonError(c, 404, 'not_found')

    return c.json({ id: c.req.param('id') })
  })

  app.delete('/api/messages/drafts/:id', async (c) => {
    const id = c.req.param('id')
    if (!(await isDraft(c.env.DB, id))) return jsonError(c, 404, 'not_found')
    const ok = await deleteDraft(c.env.DB, id)
    if (!ok) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true })
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

  app.post('/api/messages/:id/star', async (c) => {
    let body: { starred?: unknown }
    try {
      body = (await c.req.json()) as { starred?: unknown }
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }
    if (typeof body.starred !== 'boolean') {
      return jsonError(c, 400, 'invalid_body')
    }
    const ok = await setStarred(c.env.DB, c.req.param('id'), body.starred)
    if (!ok) return jsonError(c, 404, 'not_found')
    return c.json({ ok: true, starred: body.starred })
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
