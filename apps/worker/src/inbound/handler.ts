import type { Env } from '../env'
import { findEnabledAliasByAddress } from '../aliases/service'
import { applyFiltersToMessage } from '../filters/service'
import { insertInboundMessage } from '../messages/service'
import { parseInboundMime } from './parse'

/**
 * Cloudflare Email Routing inbound handler.
 *
 * Unknown / disabled recipients: accept and drop (early return, no setReject)
 * to avoid SMTP backscatter. Matched enabled aliases are parsed and stored
 * in D1 inbox; attachments set has_unsupported_attachments=1 but body is kept.
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
    hasUnsupportedAttachments: parsed.hasUnsupportedAttachments,
  })

  await applyFiltersToMessage(env.DB, id)
}
