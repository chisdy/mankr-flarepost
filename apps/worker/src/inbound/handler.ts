import { storeInboundAttachments } from '../attachments/service'
import { findEnabledAliasByAddress } from '../aliases/service'
import type { Env } from '../env'
import { applyFiltersToMessage } from '../filters/service'
import { insertInboundMessage } from '../messages/service'
import { parseInboundMime } from './parse'

/**
 * Email Routing Worker entry: accept mail for enabled aliases, store message
 * in D1 inbox; store attachments in R2 when binding is available.
 * After insert, enabled filters are applied (tags / star / trash).
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const alias = await findEnabledAliasByAddress(env.DB, message.to)
  if (!alias) {
    // Accept & drop — do not setReject (no bounce / backscatter).
    return
  }

  const raw = await new Response(message.raw).arrayBuffer()
  const parsed = await parseInboundMime(raw)
  const fromAddr = parsed.fromAddr || message.from

  const { id } = await insertInboundMessage(env.DB, {
    aliasId: alias.id,
    fromAddr,
    toAddrs: [message.to],
    subject: parsed.subject,
    textBody: parsed.textBody,
    htmlBody: parsed.htmlBody,
    hasUnsupportedAttachments: false,
  })

  let skipped = false
  if (parsed.attachments.length > 0) {
    if (env.ATTACHMENTS) {
      const result = await storeInboundAttachments(
        env.DB,
        env.ATTACHMENTS,
        id,
        parsed.attachments,
      )
      skipped = result.skipped
    } else {
      skipped = true
    }
  }

  if (skipped) {
    await env.DB
      .prepare(`UPDATE messages SET has_unsupported_attachments = 1 WHERE id = ?`)
      .bind(id)
      .run()
  }

  await applyFiltersToMessage(env.DB, id)
}
