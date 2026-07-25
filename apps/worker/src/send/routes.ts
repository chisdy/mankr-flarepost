import type { Context, Hono } from 'hono'
import { getSendAdapter, isSendError, type SendErrorCode } from '../adapters/send'
import {
  AttachmentLimitError,
  AttachmentNotFoundError,
  getAttachmentsByIds,
  linkAttachmentsToMessage,
  reassignAttachments,
  uint8ToBase64,
} from '../attachments/service'
import { findAliasById } from '../aliases/service'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import { getMessage, insertOutboundMessage, deleteDraft } from '../messages/service'
import { checkRateLimit, incrementRateLimit } from './rate-limit'

type SendEnv = { Bindings: Env; Variables: AppVariables }
type SendApp = Hono<SendEnv>
type SendContext = Context<SendEnv>

type SendBody = {
  fromAliasId?: unknown
  to?: unknown
  subject?: unknown
  text?: unknown
  html?: unknown
  replyToMessageId?: unknown
  draftId?: unknown
  attachmentIds?: unknown
}

const ERROR_STATUS: Record<SendErrorCode, 400 | 429 | 502> = {
  invalid_address: 400,
  rate_limited: 429,
  not_configured: 502,
  provider_error: 502,
  attachments_unsupported: 400,
}

const ERROR_MESSAGE: Record<SendErrorCode, string> = {
  not_configured:
    'Send channel is not configured. For Total Free arbitrary outbound, set SEND_CHANNEL=resend and RESEND_API_KEY.',
  rate_limited: 'Send rate limit exceeded (30 per hour).',
  invalid_address: 'Invalid sender or recipient address.',
  provider_error: 'Email provider failed to send the message.',
  attachments_unsupported:
    'Attachments require SEND_CHANNEL=resend. Cloudflare and Mailchannels paths do not send files.',
}

function sendError(c: SendContext, code: SendErrorCode) {
  return c.json({ error: code, message: ERROR_MESSAGE[code] }, ERROR_STATUS[code])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseTo(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const addrs = value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  if (addrs.length !== value.length) return null
  return addrs.map((a) => a.trim())
}

function parseAttachmentIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  if (!value.every((x): x is string => typeof x === 'string' && x.trim().length > 0)) {
    return null
  }
  return [...new Set(value.map((x) => x.trim()))]
}

export function registerSendRoutes(app: SendApp): void {
  app.post('/api/messages/send', async (c) => {
    let body: SendBody
    try {
      body = (await c.req.json()) as SendBody
    } catch {
      return sendError(c, 'invalid_address')
    }

    if (!isNonEmptyString(body.fromAliasId)) {
      return sendError(c, 'invalid_address')
    }
    const to = parseTo(body.to)
    if (!to) {
      return sendError(c, 'invalid_address')
    }
    if (typeof body.subject !== 'string' || typeof body.text !== 'string') {
      return sendError(c, 'invalid_address')
    }
    const html = typeof body.html === 'string' ? body.html : undefined
    const attachmentIds = parseAttachmentIds(body.attachmentIds)
    if (attachmentIds === null) {
      return sendError(c, 'invalid_address')
    }

    const alias = await findAliasById(c.env.DB, body.fromAliasId.trim())
    if (!alias || !alias.enabled) {
      return sendError(c, 'invalid_address')
    }

    const rate = checkRateLimit(alias.address)
    if (!rate.ok) {
      return sendError(c, 'rate_limited')
    }

    let replyTo: string | undefined
    if (isNonEmptyString(body.replyToMessageId)) {
      const original = await getMessage(c.env.DB, body.replyToMessageId.trim())
      if (original) {
        replyTo = original.fromAddr
      }
    }

    const draftId = isNonEmptyString(body.draftId) ? body.draftId.trim() : null

    // Collect attachment ids from request + already linked to draft. The folder check
    // matters: this path later reassigns those attachments and deletes the row, so a
    // non-draft id would strip another message's attachments.
    const idSet = new Set(attachmentIds)
    if (draftId) {
      const draft = await getMessage(c.env.DB, draftId)
      if (!draft || draft.folder !== 'draft') {
        return jsonError(c, 400, 'invalid_draft')
      }
      for (const a of draft.attachments) idSet.add(a.id)
    }
    const allIds = [...idSet]

    let sendAttachments:
      | { filename: string; contentType: string; contentBase64: string }[]
      | undefined

    if (allIds.length > 0) {
      if (!c.env.ATTACHMENTS) {
        return sendError(c, 'attachments_unsupported')
      }
      const rows = await getAttachmentsByIds(c.env.DB, allIds)
      if (rows.length !== allIds.length) {
        return c.json({ error: 'not_found', message: 'Attachment not found' }, 400)
      }
      for (const row of rows) {
        if (row.message_id && draftId && row.message_id !== draftId) {
          return c.json(
            { error: 'attachment_limit', message: 'Attachment already linked to another message' },
            400,
          )
        }
        if (row.message_id && !draftId) {
          return c.json(
            { error: 'attachment_limit', message: 'Attachment already linked to another message' },
            400,
          )
        }
      }

      sendAttachments = []
      for (const row of rows) {
        const obj = await c.env.ATTACHMENTS.get(row.r2_key)
        if (!obj) {
          return c.json({ error: 'not_found', message: 'Attachment blob missing' }, 400)
        }
        const bytes = new Uint8Array(await obj.arrayBuffer())
        sendAttachments.push({
          filename: row.filename,
          contentType: row.content_type,
          contentBase64: uint8ToBase64(bytes),
        })
      }
    }

    const adapter = getSendAdapter(c.env)
    const result = await adapter.send({
      from: alias.address,
      to,
      subject: body.subject,
      text: body.text,
      html,
      replyTo,
      attachments: sendAttachments,
    })

    if (isSendError(result)) {
      return sendError(c, result.error)
    }

    incrementRateLimit(alias.address)

    const stored = await insertOutboundMessage(c.env.DB, {
      aliasId: alias.id,
      fromAddr: alias.address,
      toAddrs: to,
      subject: body.subject,
      textBody: body.text,
      htmlBody: html ?? null,
      providerMessageId: result.id ?? null,
    })

    try {
      if (draftId) {
        await reassignAttachments(c.env.DB, draftId, stored.id)
      }
      if (attachmentIds.length > 0) {
        await linkAttachmentsToMessage(c.env.DB, stored.id, attachmentIds)
      }
    } catch (e) {
      if (e instanceof AttachmentNotFoundError || e instanceof AttachmentLimitError) {
        // Message already sent — keep sent copy; surface soft failure
        console.error('Failed to link attachments after send', e)
      } else {
        throw e
      }
    }

    if (draftId) {
      // Attachment rows already reassigned; skip R2 delete
      await deleteDraft(c.env.DB, draftId)
    }

    return c.json({ id: stored.id, providerMessageId: result.id ?? null })
  })
}