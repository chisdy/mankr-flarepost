import { findEnabledAliasByAddress } from '../aliases/service'
import type { Env } from '../env'
import { applyFiltersToMessage } from '../filters/service'
import { insertInboundMessage } from '../messages/service'
import { parseInboundMime } from './parse'

/**
 * Email Routing Worker entry: accept mail for enabled aliases, store message
 * in D1 inbox. Attachment bytes are dropped (no object storage) — the message is
 * flagged so the UI can say so. After insert, enabled filters are applied.
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
    hasUnsupportedAttachments: parsed.hasAttachments,
  })

  await applyFiltersToMessage(env.DB, id)
}
