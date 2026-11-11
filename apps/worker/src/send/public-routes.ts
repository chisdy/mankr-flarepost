import type { Context, Hono } from 'hono'
import {
  getSendAdapter,
  isSendError,
  type SendErrorCode,
} from '../adapters/send'
import {
  insertSendLogStatement,
  pruneSendLogsStatement,
  type ApiKeyWithAlias,
} from '../api-keys/service'
import {
  checkQuota,
  incrementQuotaStatement,
  pruneQuotaStatement,
} from '../api-keys/quota'
import type { Env } from '../env'
import type { AppVariables } from '../http/middleware'
import { requireApiKey } from '../http/middleware'
import { recordSendStatements } from '../usage/send-usage'
import {
  claimSendRequest,
  finishSendRequest,
  pruneSendRequests,
} from './requests'

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
  not_configured:
    'Outbound mail is not configured. Set a provider API key in Settings or as a Worker secret.',
  provider_error: 'Email provider failed to send the message.',
}

function publicSendError(
  c: PublicSendContext,
  code: keyof typeof ERROR_STATUS,
) {
  return c.json(
    { error: code, message: ERROR_MESSAGE[code] },
    ERROR_STATUS[code],
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseTo(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_RECIPIENTS
  )
    return null
  const addrs = value.filter(
    (x): x is string => typeof x === 'string' && validAddress(x.trim()),
  )
  if (addrs.length !== value.length) return null
  return addrs.map((a) => a.trim())
}

function validAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)
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
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return publicSendError(c, 'invalid_address')

    const to = parseTo(body.to)
    if (!to) return publicSendError(c, 'invalid_address')
    if (typeof body.subject !== 'string' || typeof body.text !== 'string') {
      return publicSendError(c, 'invalid_address')
    }
    if (
      body.subject.length > MAX_SUBJECT_LENGTH ||
      body.text.length > MAX_BODY_LENGTH
    ) {
      return publicSendError(c, 'invalid_address')
    }
    if (
      body.html !== undefined &&
      body.html !== null &&
      typeof body.html !== 'string'
    )
      return publicSendError(c, 'invalid_address')
    const html =
      typeof body.html === 'string'
        ? body.html.length > MAX_BODY_LENGTH
          ? null
          : body.html
        : undefined
    if (html === null) return publicSendError(c, 'invalid_address')

    let replyTo: string | undefined
    if (body.replyTo !== undefined && body.replyTo !== null) {
      if (!isNonEmptyString(body.replyTo) || !validAddress(body.replyTo.trim()))
        return publicSendError(c, 'invalid_address')
      replyTo = body.replyTo.trim()
    }

    const idempotencyKey = c.req.header('Idempotency-Key')
    if (
      idempotencyKey !== undefined &&
      !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey)
    ) {
      return c.json(
        {
          error: 'invalid_idempotency_key',
          message: 'Use 1–128 visible ASCII characters.',
        },
        400,
      )
    }
    let requestId: string | undefined
    if (idempotencyKey) {
      const claim = await claimSendRequest(
        c.env.DB,
        apiKey.id,
        idempotencyKey,
        JSON.stringify([
          apiKey.aliasAddress,
          to,
          body.subject,
          body.text,
          html ?? null,
          replyTo ?? null,
        ]),
      )
      if (!claim.owned) {
        const row = claim.existing
        if (claim.conflict)
          return c.json(
            { error: 'idempotency_conflict', requestId: row.id },
            409,
          )
        if (row.state === 'accepted') {
          c.header('Idempotent-Replayed', 'true')
          return c.json(
            { id: row.log_id, providerMessageId: row.provider_message_id },
            201,
          )
        }
        if (row.state === 'failed')
          return publicSendError(
            c,
            (row.error_code ?? 'provider_error') as keyof typeof ERROR_STATUS,
          )
        if (
          row.state === 'processing' &&
          Date.now() - row.updated_at < 120_000
        ) {
          c.header('Retry-After', '5')
          return c.json(
            { error: 'request_in_progress', requestId: row.id },
            409,
          )
        }
        return c.json(
          {
            error: 'provider_error',
            message:
              'Acceptance is unknown. Check the provider before sending again.',
            state: 'unknown',
            retryable: false,
            requestId: row.id,
          },
          502,
        )
      }
      requestId = claim.id
    }

    const { verdict } = await checkQuota(c.env.DB, apiKey)
    if (!verdict.ok) {
      if (requestId)
        await finishSendRequest(c.env.DB, requestId, {
          state: 'failed',
          errorCode: 'quota_exceeded',
        }).run()
      return publicSendError(c, 'quota_exceeded')
    }

    const adapter = await getSendAdapter(c.env)
    const result = await adapter.send({
      from: apiKey.aliasAddress,
      to,
      subject: body.subject,
      text: body.text,
      html,
      replyTo,
      trackOutcome: true,
      idempotencyKey: requestId ? `mfp/${requestId}` : undefined,
    })

    const now = Date.now()
    const logId = crypto.randomUUID()

    if (isSendError(result)) {
      const code =
        result.error === 'rate_limited' ? 'provider_error' : result.error
      const unknown = result.outcome === 'unknown'
      try {
        await c.env.DB.batch([
          ...(requestId
            ? [
                finishSendRequest(
                  c.env.DB,
                  requestId,
                  {
                    state: unknown ? 'unknown' : 'failed',
                    provider: adapter.provider,
                    logId,
                    errorCode: code,
                  },
                  now,
                ),
              ]
            : []),
          insertSendLogStatement(
            c.env.DB,
            {
              id: logId,
              apiKeyId: apiKey.id,
              fromAddr: apiKey.aliasAddress,
              toAddrs: to,
              subject: body.subject,
              status: 'failed',
              errorCode: unknown ? 'outcome_unknown' : code,
            },
            now,
          ),
          pruneSendLogsStatement(c.env.DB, now),
          pruneQuotaStatement(c.env.DB, now),
        ])
      } catch (error) {
        if (!unknown) throw error
        // Logging failures must not turn an ambiguous send into a retryable 500.
        if (requestId) {
          await finishSendRequest(
            c.env.DB,
            requestId,
            {
              state: 'unknown',
              provider: adapter.provider,
              errorCode: 'persistence_failed',
            },
            now,
          )
            .run()
            .catch(() => undefined)
        }
      }
      if (unknown)
        return c.json(
          {
            error: code,
            message:
              'Acceptance is unknown. Check the provider before sending again.',
            state: 'unknown',
            retryable: false,
            requestId: requestId ?? logId,
          },
          502,
        )
      return publicSendError(c, code)
    }

    // Soft quota: increment only after the provider accepts the message.
    try {
      await c.env.DB.batch([
        ...(requestId
          ? [
              finishSendRequest(
                c.env.DB,
                requestId,
                {
                  state: 'accepted',
                  provider: adapter.provider,
                  providerMessageId: result.id,
                  logId,
                },
                now,
              ),
              pruneSendRequests(c.env.DB, now),
            ]
          : []),
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
    } catch {
      // Provider acceptance cannot be undone. Never invite an automatic resend.
      if (requestId) {
        await finishSendRequest(
          c.env.DB,
          requestId,
          {
            state: 'unknown',
            provider: adapter.provider,
            providerMessageId: result.id,
            errorCode: 'persistence_failed',
          },
          now,
        )
          .run()
          .catch(() => undefined)
      }
      return c.json(
        {
          error: 'provider_error',
          message:
            'Provider accepted the message; local recording failed. Check the provider before sending again.',
          state: 'unknown',
          retryable: false,
          requestId: requestId ?? logId,
        },
        502,
      )
    }

    return c.json({ id: logId, providerMessageId: result.id ?? null }, 201)
  })
}
