import type { Context, Hono } from 'hono'
import { getSendAdapter, isSendError, type SendErrorCode, type SendResult } from '../adapters/send'
import { findAliasById } from '../aliases/service'
import { hashApiKey as sha256 } from '../api-keys/service'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import { checkRateLimit, incrementRateLimit } from './rate-limit'
import {
  claimWebSendRequest,
  finalizeWebSend,
  readWebSendForDraft,
  readWebSendRequest,
  recordPendingWebSendAcceptance,
  recordWebSendError,
  WEB_SEND_PROCESSING_MS,
  type AcceptedMail,
  type WebSendRequest,
} from './web-requests'

type SendEnv = { Bindings: Env; Variables: AppVariables }
type SendApp = Hono<SendEnv>
type SendContext = Context<SendEnv>

type SendBody = {
  fromAliasId?: unknown
  to?: unknown
  subject?: unknown
  text?: unknown
  html?: unknown
  draftId?: unknown
}

// Keeps pending acceptance data comfortably below D1's string and row size limits.
const MAX_WEB_PAYLOAD_BYTES = 512_000
const REQUEST_KEY = /^[A-Za-z0-9._-]{1,128}$/

const ERROR_STATUS: Record<SendErrorCode, 400 | 429 | 502> = {
  invalid_address: 400,
  rate_limited: 429,
  not_configured: 502,
  provider_error: 502,
}

const ERROR_MESSAGE: Record<SendErrorCode, string> = {
  not_configured:
    'Outbound mail is not configured. Set a provider API key in Settings or as a Worker secret.',
  rate_limited: 'Send rate limit exceeded (30 per hour).',
  invalid_address: 'Invalid sender or recipient address.',
  provider_error: 'The email provider rejected the message.',
}

function sendError(c: SendContext, code: SendErrorCode, requestKey?: string) {
  return c.json({
    error: code,
    message: ERROR_MESSAGE[code],
    status: 'failed',
    ...(requestKey ? { requestKey } : {}),
  }, ERROR_STATUS[code])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseTo(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const addrs = value.filter((addr): addr is string =>
    typeof addr === 'string' && /^[^\s<>@\x00-\x1f\x7f]+@[^\s<>@\x00-\x1f\x7f]+$/.test(addr.trim()),
  )
  return addrs.length === value.length ? addrs.map((addr) => addr.trim()) : null
}

function acceptedResponse(
  c: SendContext,
  request: Pick<WebSendRequest, 'id' | 'request_key' | 'provider_message_id'>,
  saved: boolean,
) {
  return c.json({
    id: request.id,
    providerMessageId: request.provider_message_id,
    status: 'accepted',
    saved,
    requestKey: request.request_key,
  })
}

function existingResponse(c: SendContext, request: WebSendRequest) {
  if (request.state === 'accepted' || request.state === 'accepted_pending') {
    return acceptedResponse(c, request, request.state === 'accepted')
  }
  if (request.state === 'failed') {
    return sendError(c, request.error_code ?? 'provider_error', request.request_key)
  }
  const pending = request.state === 'processing' &&
    Date.now() - request.created_at < WEB_SEND_PROCESSING_MS
  return c.json({
    error: pending ? 'send_processing' : 'send_outcome_unknown',
    status: pending ? 'processing' : 'unknown',
    requestKey: request.request_key,
  }, 409)
}

function draftConflict(c: SendContext, request: WebSendRequest) {
  return c.json({ error: 'draft_send_exists', requestKey: request.request_key }, 409)
}

function draftChanged(c: SendContext) {
  return c.json({ error: 'send_draft_changed', status: 'failed' }, 409)
}

function replayOrConflict(c: SendContext, request: WebSendRequest, key: string, hash: string) {
  if (request.request_key !== key) return draftConflict(c, request)
  if (request.payload_hash !== hash) return jsonError(c, 409, 'idempotency_conflict')
  if (request.state === 'accepted_pending' && request.pending_payload) {
    return finalizeAccepted(c, request, JSON.parse(request.pending_payload) as AcceptedMail)
  }
  return existingResponse(c, request)
}

async function finalizeAccepted(c: SendContext, request: WebSendRequest, mail: AcceptedMail) {
  const db = c.env.DB
  const accepted = { ...request, provider_message_id: mail.message.providerMessageId }
  try {
    await finalizeWebSend(db, request, mail)
    return acceptedResponse(c, accepted, true)
  } catch {
    if (request.state === 'processing') {
      // The provider accepted the message. Store its outcome even if the complete
      // Sent/draft transaction cannot finish; only local work may be retried.
      await recordPendingWebSendAcceptance(db, request.id, mail).catch(() => {})
    }
    const latest = await readWebSendRequest(db, request.request_key).catch(() => null)
    if (latest?.state === 'accepted') return acceptedResponse(c, latest, true)
    console.warn('Web send accepted; local finalization pending', { id: request.id })
    return acceptedResponse(c, accepted, false)
  }
}

export function registerSendRoutes(app: SendApp): void {
  app.get('/api/messages/send/:key', async (c) => {
    c.header('Cache-Control', 'no-store')
    const key = c.req.param('key')
    const existing = REQUEST_KEY.test(key) && await readWebSendRequest(c.env.DB, key)
    return existing ? existingResponse(c, existing) : jsonError(c, 404, 'send_not_found')
  })

  app.post('/api/messages/send/:key/reconcile', async (c) => {
    c.header('Cache-Control', 'no-store')
    const key = c.req.param('key')
    const existing = REQUEST_KEY.test(key) && await readWebSendRequest(c.env.DB, key, true)
    if (!existing) return jsonError(c, 404, 'send_not_found')
    if (existing.state === 'accepted_pending' && existing.pending_payload) {
      const mail = JSON.parse(existing.pending_payload) as AcceptedMail
      return finalizeAccepted(c, existing, mail)
    }
    return existingResponse(c, existing)
  })

  app.post('/api/messages/send', async (c) => {
    c.header('Cache-Control', 'no-store')
    const key = c.req.header('Idempotency-Key') ?? ''
    if (!REQUEST_KEY.test(key)) return jsonError(c, 400, 'invalid_idempotency_key')

    let body: SendBody
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, 'invalid_address')
    }
    if (!body || !isNonEmptyString(body.fromAliasId)) return sendError(c, 'invalid_address')
    const to = parseTo(body.to)
    if (!to || typeof body.subject !== 'string' || typeof body.text !== 'string') {
      return sendError(c, 'invalid_address')
    }
    const aliasId = body.fromAliasId.trim()
    const draftId = isNonEmptyString(body.draftId) ? body.draftId.trim() : null
    const html = typeof body.html === 'string' ? body.html : undefined
    const payload = JSON.stringify([aliasId, to, body.subject, body.text, html ?? null, draftId])
    if (new TextEncoder().encode(payload).byteLength > MAX_WEB_PAYLOAD_BYTES) {
      return c.json({ error: 'send_message_too_large', status: 'failed' }, 413)
    }
    const hash = await sha256(payload)
    const db = c.env.DB
    const existing = await readWebSendRequest(db, key, true)
    if (existing) return replayOrConflict(c, existing, key, hash)

    let draftUpdatedAt: number | null = null
    if (draftId) {
      const active = await readWebSendForDraft(db, draftId)
      if (active) return replayOrConflict(c, active, key, hash)
      const draft = await db.prepare(
        `SELECT created_at, alias_id = ? AND to_addrs = ? AND subject = ?
           AND text_body = ? AND html_body IS ? AS matches
         FROM messages WHERE id = ? AND folder = 'draft'`,
      ).bind(aliasId, JSON.stringify(to), body.subject, body.text, html ?? null, draftId)
        .first<{ created_at: number; matches: number }>()
      if (!draft) {
        const raced = await readWebSendForDraft(db, draftId)
        return raced ? replayOrConflict(c, raced, key, hash) : jsonError(c, 400, 'invalid_draft')
      }
      if (!draft.matches) return draftChanged(c)
      draftUpdatedAt = draft.created_at
    }

    const alias = await findAliasById(db, aliasId)
    if (!alias?.enabled) return sendError(c, 'invalid_address')
    const rate = checkRateLimit(alias.address)
    if (!rate.ok) return sendError(c, 'rate_limited', key)

    // The successful insert is the only path to a provider call. Pending, failed
    // and unknown claims are never reassigned, regardless of provider support.
    const adapter = await getSendAdapter(c.env)
    const request = await claimWebSendRequest(db, key, hash, draftId, draftUpdatedAt)
    if (!request) {
      const replay = await readWebSendRequest(db, key, true)
      if (replay) return replayOrConflict(c, replay, key, hash)
      const active = draftId && await readWebSendForDraft(db, draftId)
      if (active) return replayOrConflict(c, active, key, hash)
      // The draft changed before the claim could be written, or another attempt
      // was rejected between the competing insert and our read of its lock.
      return draftChanged(c)
    }

    const result: SendResult = await adapter.send({
      from: alias.address,
      to,
      subject: body.subject,
      text: body.text,
      html,
      trackOutcome: true,
      idempotencyKey: `mfp/web/${request.id}`,
    }).catch(() => ({ error: 'provider_error', outcome: 'unknown' }) as const)

    if (isSendError(result)) {
      const state = result.outcome === 'unknown' ? 'unknown' : 'failed'
      await recordWebSendError(db, request.id, state, result.error).catch(() => {})
      return existingResponse(c, { ...request, state, error_code: result.error })
    }

    incrementRateLimit(alias.address)
    return finalizeAccepted(c, request, {
      message: {
        aliasId: alias.id,
        fromAddr: alias.address,
        toAddrs: to,
        subject: body.subject,
        textBody: body.text,
        htmlBody: html ?? null,
        providerMessageId: typeof result.id === 'string' ? result.id : null,
      },
      provider: adapter.provider,
      quota: result.quota,
      acceptedAt: Date.now(),
      draftUpdatedAt,
    })
  })
}
