import type { Context, Hono } from 'hono'
import { getSendAdapter, isSendError, type SendErrorCode } from '../adapters/send'
import { findAliasById } from '../aliases/service'
import type { Env } from '../env'
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
}

const ERROR_STATUS: Record<SendErrorCode, 400 | 429 | 502> = {
  invalid_address: 400,
  rate_limited: 429,
  not_configured: 502,
  provider_error: 502,
}

const ERROR_MESSAGE: Record<SendErrorCode, string> = {
  not_configured:
    'Send channel is not configured. For Total Free arbitrary outbound, set SEND_CHANNEL=resend and RESEND_API_KEY.',
  rate_limited: 'Send rate limit exceeded (30 per hour).',
  invalid_address: 'Invalid sender or recipient address.',
  provider_error: 'Email provider failed to send the message.',
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

    const adapter = getSendAdapter(c.env)
    const result = await adapter.send({
      from: alias.address,
      to,
      subject: body.subject,
      text: body.text,
      html,
      replyTo,
    })

    if (isSendError(result)) {
      return sendError(c, result.error)
    }

    // Only consume soft quota after provider accepts the message
    incrementRateLimit(alias.address)

    // Only persist to sent folder after provider accepts the message
    const stored = await insertOutboundMessage(c.env.DB, {
      aliasId: alias.id,
      fromAddr: alias.address,
      toAddrs: to,
      subject: body.subject,
      textBody: body.text,
      htmlBody: html ?? null,
      providerMessageId: result.id ?? null,
    })

    if (isNonEmptyString(body.draftId)) {
      await deleteDraft(c.env.DB, body.draftId.trim())
    }

    return c.json({ id: stored.id, providerMessageId: result.id ?? null })
  })
}
