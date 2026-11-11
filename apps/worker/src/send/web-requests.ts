import type { ProviderQuotaReading, SendErrorCode, SendProviderId } from '../adapters/send'
import { prepareOutboundMessage, type InsertOutboundMessageInput } from '../messages/service'
import { recordSendStatements } from '../usage/send-usage'

export type WebSendRequest = {
  id: string
  request_key: string
  payload_hash: string
  draft_id: string | null
  state: 'processing' | 'accepted_pending' | 'accepted' | 'failed' | 'unknown'
  provider_message_id: string | null
  error_code: SendErrorCode | null
  pending_payload?: string | null
  created_at: number
}

export type AcceptedMail = {
  message: InsertOutboundMessageInput
  provider: SendProviderId
  quota?: ProviderQuotaReading
  acceptedAt: number
  /** Avoid discarding a version another tab edited while the provider was working. */
  draftUpdatedAt: number | null
}

// Provider adapters abort after 30 seconds. An interrupted owner must never be replaced.
export const WEB_SEND_PROCESSING_MS = 60_000

const REQUEST_COLUMNS = `id, request_key, payload_hash, draft_id, state,
  provider_message_id, error_code, created_at`

export function readWebSendRequest(db: D1Database, key: string, includePending = false) {
  return db.prepare(
    `SELECT ${REQUEST_COLUMNS}${includePending ? ', pending_payload' : ''}
     FROM web_send_requests WHERE request_key = ?`,
  ).bind(key).first<WebSendRequest>()
}

export function readWebSendForDraft(db: D1Database, draftId: string) {
  return db.prepare(
    `SELECT ${REQUEST_COLUMNS} FROM web_send_requests WHERE draft_id = ? AND state <> 'failed'`,
  ).bind(draftId).first<WebSendRequest>()
}

export async function claimWebSendRequest(
  db: D1Database,
  key: string,
  payloadHash: string,
  draftId: string | null,
  draftUpdatedAt: number | null,
): Promise<WebSendRequest | null> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const result = await db.prepare(
    `INSERT INTO web_send_requests (id, request_key, payload_hash, draft_id, state, created_at)
     SELECT ?, ?, ?, ?, 'processing', ?
     WHERE ? IS NULL OR EXISTS (
       SELECT 1 FROM messages WHERE id = ? AND folder = 'draft' AND created_at = ?
     )
     ON CONFLICT DO NOTHING`,
  ).bind(id, key, payloadHash, draftId, createdAt, draftId, draftId, draftUpdatedAt).run()
  if (!result.meta.changes) return null
  return {
    id, request_key: key, payload_hash: payloadHash, draft_id: draftId,
    state: 'processing', provider_message_id: null, error_code: null,
    pending_payload: null, created_at: createdAt,
  }
}

export function recordWebSendError(
  db: D1Database,
  id: string,
  state: 'failed' | 'unknown',
  code: SendErrorCode,
) {
  return db.prepare(
    `UPDATE web_send_requests SET state = ?, error_code = ? WHERE id = ? AND state = 'processing'`,
  ).bind(state, code, id).run()
}

export function recordPendingWebSendAcceptance(db: D1Database, id: string, mail: AcceptedMail) {
  return db.prepare(
    `UPDATE web_send_requests SET state = 'accepted_pending', provider_message_id = ?, pending_payload = ?
     WHERE id = ? AND state = 'processing'`,
  ).bind(mail.message.providerMessageId, JSON.stringify(mail), id).run()
}

export async function finalizeWebSend(
  db: D1Database,
  request: WebSendRequest,
  mail: AcceptedMail,
) {
  // Setting a NOT NULL state to NULL aborts the entire batch if another caller
  // already finalized it. This also protects replays if the sent message was deleted.
  const statements = [
    db.prepare(
      `UPDATE web_send_requests
       SET state = CASE WHEN state = ? THEN 'accepted' ELSE NULL END,
           provider_message_id = ?, pending_payload = NULL,
           draft_id = CASE WHEN EXISTS (
             SELECT 1 FROM messages
             WHERE id = web_send_requests.draft_id AND folder = 'draft' AND created_at <> ?
           ) THEN NULL ELSE draft_id END
       WHERE id = ?`,
    ).bind(request.state, mail.message.providerMessageId, mail.draftUpdatedAt, request.id),
    prepareOutboundMessage(db, mail.message, request.id, mail.acceptedAt),
    ...recordSendStatements(db, {
      provider: mail.provider,
      units: mail.message.toAddrs.length,
      quota: mail.quota,
    }, mail.acceptedAt),
  ]
  if (request.draft_id && mail.draftUpdatedAt !== null) {
    // Message tags already cascade when the draft is deleted.
    statements.push(db.prepare(
      `DELETE FROM messages WHERE id = ? AND folder = 'draft' AND created_at = ?`,
    ).bind(request.draft_id, mail.draftUpdatedAt))
  }
  await db.batch(statements)
}
