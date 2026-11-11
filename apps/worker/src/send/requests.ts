import { hashApiKey } from '../api-keys/service'

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000
export type SendRequestRow = {
  id: string
  payload_hash: string
  state: 'processing' | 'accepted' | 'failed' | 'unknown'
  provider: string | null
  provider_message_id: string | null
  log_id: string | null
  error_code: string | null
  created_at: number
  updated_at: number
  expires_at: number
}

/** An expired key is replaced in the same atomic write that claims a fresh key. */
export async function claimSendRequest(
  db: D1Database,
  keyId: string,
  key: string,
  payload: string,
  now = Date.now(),
) {
  const [keyHash, payloadHash] = await Promise.all([
    hashApiKey(key),
    hashApiKey(payload),
  ])
  const id = crypto.randomUUID()
  const result = await db
    .prepare(
      `
    INSERT INTO api_send_requests (id, api_key_id, idempotency_key_hash, payload_hash, state, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, 'processing', ?, ?, ?)
    ON CONFLICT (api_key_id, idempotency_key_hash) DO UPDATE SET
      id = excluded.id, payload_hash = excluded.payload_hash, state = 'processing',
      provider = NULL, provider_message_id = NULL, log_id = NULL, error_code = NULL,
      created_at = excluded.created_at, updated_at = excluded.updated_at, expires_at = excluded.expires_at
    WHERE api_send_requests.expires_at <= excluded.created_at
  `,
    )
    .bind(
      id,
      keyId,
      keyHash,
      payloadHash,
      now,
      now,
      now + IDEMPOTENCY_WINDOW_MS,
    )
    .run()
  if (result.meta.changes) return { owned: true as const, id }
  const existing = await db
    .prepare(
      `SELECT * FROM api_send_requests WHERE api_key_id = ? AND idempotency_key_hash = ?`,
    )
    .bind(keyId, keyHash)
    .first<SendRequestRow>()
  if (!existing) throw new Error('Idempotency claim disappeared')
  return {
    owned: false as const,
    existing,
    conflict: existing.payload_hash !== payloadHash,
  }
}

export function finishSendRequest(
  db: D1Database,
  id: string,
  input: {
    state: 'accepted' | 'failed' | 'unknown'
    provider?: string
    providerMessageId?: string | null
    logId?: string
    errorCode?: string
  },
  now = Date.now(),
) {
  return db
    .prepare(
      `UPDATE api_send_requests SET state = ?, provider = ?, provider_message_id = ?,
    log_id = ?, error_code = ?, updated_at = ? WHERE id = ? AND state = 'processing'`,
    )
    .bind(
      input.state,
      input.provider ?? null,
      input.providerMessageId ?? null,
      input.logId ?? null,
      input.errorCode ?? null,
      now,
      id,
    )
}

/** Bounded cleanup, separate from the 24h validity check above. */
export function pruneSendRequests(db: D1Database, now = Date.now()) {
  return db
    .prepare(
      `DELETE FROM api_send_requests WHERE id IN (
    SELECT id FROM api_send_requests WHERE expires_at < ? LIMIT 100
  )`,
    )
    .bind(now - IDEMPOTENCY_WINDOW_MS)
}
