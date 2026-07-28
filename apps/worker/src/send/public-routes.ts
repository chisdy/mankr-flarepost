import type { Context, Hono } from 'hono'
import { getSendAdapter, isSendError, type SendErrorCode } from '../adapters/send'
import {
  insertSendLogStatement,
  pruneSendLogsStatement,
  type ApiKeyWithAlias,
} from '../api-keys/service'
import { checkQuota, incrementQuotaStatement, pruneQuotaStatement } from '../api-keys/quota'
import type { Env } from '../env'
import type { AppVariables } from '../http/middleware'
import { requireApiKey } from '../http/middleware'
import { recordSendStatements } from '../usage/send-usage'

type PublicSendEnv = { Bindings: Env; Variables: AppVariables }
type PublicSendApp = Hono<PublicSendEnv>
type PublicSendContext = Context<PublicSendEnv>

const MAX_RECIPIENTS = 10
const MAX_SUBJECT_LENGTH = 998
const MAX_BODY_LENGTH = 100_000

type PublicSendBody = {
  to?: unknown
  subject?: unknown
  text?: unknown
  html?: unknown
  replyTo?: unknown
}

const ERROR_STATUS: Record<
  Exclude<SendErrorCode, 'rate_limited'> | 'quota_exceeded' | 'unauthorized',
  400 | 401 | 429 | 502
> = {
  unauthorized: 401,
  invalid_address: 400,
  quota_exceeded: 429,
  not_configured: 502,
  provider_error: 502,
}

const ERROR_MESSAGE: Record<keyof typeof ERROR_STATUS, string> = {
  unauthorized: 'Missing or invalid API key.',
  invalid_address: 'Invalid sender or recipient address.',
  quota_exceeded: 'API key send quota exceeded.',
  not_configured: 'Outbound mail is not configured. Set the RESEND_API_KEY secret.',
  provider_error: 'Email provider failed to send the message.',
}

function publicSendError(c: PublicSendContext, code: keyof typeof ERROR_STATUS) {
  return c.json({ error: code, message: ERROR_MESSAGE[code] }, ERROR_STATUS[code])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseTo(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPIENTS) return null
  const addrs = value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  if (addrs.length !== value.length) return null
  return addrs.map((a) => a.trim())
}

export function registerPublicSendRoutes(app: PublicSendApp): void {
  // Registered before requireSession so this path stays Bearer-auth only.
  app.post('/api/v1/send', requireApiKey, async (c) => {
    const apiKey = c.get('apiKey') as ApiKeyWithAlias

    let body: PublicSendBody
    try {
      body = (await c.req.json()) as PublicSendBody
    } catch {
      return publicSendError(c, 'invalid_address')
    }

    const to = parseTo(body.to)
    if (!to) return publicSendError(c, 'invalid_address')
    if (typeof body.subject !== 'string' || typeof body.text !== 'string') {
      return publicSendError(c, 'invalid_address')
    }
    if (body.subject.length > MAX_SUBJECT_LENGTH || body.text.length > MAX_BODY_LENGTH) {
      return publicSendError(c, 'invalid_address')
    }
    const html =
      typeof body.html === 'string'
        ? body.html.length > MAX_BODY_LENGTH
          ? null
          : body.html
        : undefined
    if (html === null) return publicSendError(c, 'invalid_address')

    let replyTo: string | undefined
    if (body.replyTo !== undefined && body.replyTo !== null) {
      if (!isNonEmptyString(body.replyTo)) return publicSendError(c, 'invalid_address')
      replyTo = body.replyTo.trim()
    }

    // Alias enabled is already checked in requireApiKey; re-read is unnecessary.
    const { verdict } = await checkQuota(c.env.DB, apiKey)
    if (!verdict.ok) {
      return publicSendError(c, 'quota_exceeded')
    }

    const adapter = getSendAdapter(c.env)
    const result = await adapter.send({
      from: apiKey.aliasAddress,
      to,
      subject: body.subject,
      text: body.text,
      html,
      replyTo,
    })

    const now = Date.now()
    const logId = crypto.randomUUID()

    if (isSendError(result)) {
      const code = result.error === 'rate_limited' ? 'provider_error' : result.error
      await c.env.DB.batch([
        insertSendLogStatement(
          c.env.DB,
          {
            id: logId,
            apiKeyId: apiKey.id,
            fromAddr: apiKey.aliasAddress,
            toAddrs: to,
            subject: body.subject,
            status: 'failed',
            errorCode: code,
          },
          now,
        ),
        pruneSendLogsStatement(c.env.DB, now),
        pruneQuotaStatement(c.env.DB, now),
      ])
      return publicSendError(c, code)
    }

    // Soft quota: increment only after the provider accepts the message.
    await c.env.DB.batch([
      incrementQuotaStatement(c.env.DB, apiKey.id, now),
      insertSendLogStatement(
        c.env.DB,
        {
          id: logId,
          apiKeyId: apiKey.id,
          fromAddr: apiKey.aliasAddress,
          toAddrs: to,
          subject: body.subject,
          status: 'sent',
          providerMessageId: result.id ?? null,
        },
        now,
      ),
      // Recipients are billed individually, so the recipient count is the quota cost.
      ...recordSendStatements(
        c.env.DB,
        { provider: adapter.provider, units: to.length, quota: result.quota },
        now,
      ),
      pruneSendLogsStatement(c.env.DB, now),
      pruneQuotaStatement(c.env.DB, now),
    ])

    return c.json({ id: logId, providerMessageId: result.id ?? null }, 201)
  })
}
