export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const MAX_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024

export type AttachmentMeta = {
  id: string
  messageId: string | null
  filename: string
  contentType: string
  sizeBytes: number
  createdAt: number
}

export type AttachmentRow = {
  id: string
  message_id: string | null
  filename: string
  content_type: string
  size_bytes: number
  r2_key: string
  created_at: number
}

export function rowToAttachmentMeta(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }
}

/** Strip paths / control chars; cap length. */
export function sanitizeFilename(raw: string | null | undefined): string {
  const base = (raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!base) return 'attachment'
  return base.slice(0, 200)
}

export function sanitizeContentType(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase().split(';')[0]?.trim() ?? ''
  if (!value || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value)) {
    return 'application/octet-stream'
  }
  return value.slice(0, 100)
}

export function toUint8Array(
  content: ArrayBuffer | Uint8Array | string,
  encoding?: 'base64' | 'utf8',
): Uint8Array {
  if (typeof content === 'string') {
    if (encoding === 'base64') {
      const binary = atob(content)
      const out = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
      return out
    }
    return new TextEncoder().encode(content)
  }
  return content instanceof Uint8Array ? content : new Uint8Array(content)
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function makeR2Key(id: string, createdAt: number): string {
  const year = new Date(createdAt).getUTCFullYear()
  return `att/${year}/${id}`
}

export class AttachmentLimitError extends Error {
  readonly code = 'attachment_limit' as const
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentLimitError'
  }
}

export class AttachmentNotFoundError extends Error {
  readonly code = 'not_found' as const
  constructor() {
    super('Attachment not found')
    this.name = 'AttachmentNotFoundError'
  }
}

export async function listAttachmentsForMessage(
  db: D1Database,
  messageId: string,
): Promise<AttachmentMeta[]> {
  const { results } = await db
    .prepare(
      `SELECT id, message_id, filename, content_type, size_bytes, r2_key, created_at
       FROM attachments
       WHERE message_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(messageId)
    .all<AttachmentRow>()
  return (results ?? []).map(rowToAttachmentMeta)
}

export async function getAttachment(
  db: D1Database,
  id: string,
): Promise<AttachmentRow | null> {
  return (
    (await db
      .prepare(
        `SELECT id, message_id, filename, content_type, size_bytes, r2_key, created_at
         FROM attachments WHERE id = ?`,
      )
      .bind(id)
      .first<AttachmentRow>()) ?? null
  )
}

export async function getAttachmentsByIds(
  db: D1Database,
  ids: string[],
): Promise<AttachmentRow[]> {
  if (ids.length === 0) return []
  const unique = [...new Set(ids.map((x) => x.trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const placeholders = unique.map(() => '?').join(', ')
  const { results } = await db
    .prepare(
      `SELECT id, message_id, filename, content_type, size_bytes, r2_key, created_at
       FROM attachments
       WHERE id IN (${placeholders})`,
    )
    .bind(...unique)
    .all<AttachmentRow>()
  const byId = new Map((results ?? []).map((r) => [r.id, r]))
  return unique.map((id) => byId.get(id)).filter((r): r is AttachmentRow => !!r)
}

async function sumSizeForMessage(db: D1Database, messageId: string): Promise<{
  count: number
  totalBytes: number
}> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes), 0) AS s
       FROM attachments WHERE message_id = ?`,
    )
    .bind(messageId)
    .first<{ c: number; s: number }>()
  return { count: row?.c ?? 0, totalBytes: row?.s ?? 0 }
}

function assertCanAdd(
  currentCount: number,
  currentBytes: number,
  addCount: number,
  addBytes: number,
): void {
  if (currentCount + addCount > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentLimitError('Too many attachments for this message')
  }
  if (currentBytes + addBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw new AttachmentLimitError('Attachments exceed total size limit')
  }
}

export type StoreAttachmentInput = {
  filename: string
  contentType: string
  bytes: Uint8Array
  messageId?: string | null
}

/** Persist bytes to R2 and insert metadata. */
export async function storeAttachment(
  db: D1Database,
  r2: R2Bucket,
  input: StoreAttachmentInput,
): Promise<AttachmentMeta> {
  if (input.bytes.byteLength === 0) {
    throw new AttachmentLimitError('Empty file')
  }
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentLimitError('File exceeds size limit')
  }

  const messageId = input.messageId ?? null
  if (messageId) {
    const current = await sumSizeForMessage(db, messageId)
    assertCanAdd(current.count, current.totalBytes, 1, input.bytes.byteLength)
  }

  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const r2Key = makeR2Key(id, createdAt)
  const filename = sanitizeFilename(input.filename)
  const contentType = sanitizeContentType(input.contentType)

  await r2.put(r2Key, input.bytes, {
    httpMetadata: { contentType },
    customMetadata: { filename },
  })

  try {
    await db
      .prepare(
        `INSERT INTO attachments (
           id, message_id, filename, content_type, size_bytes, r2_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, messageId, filename, contentType, input.bytes.byteLength, r2Key, createdAt)
      .run()
  } catch (e) {
    await r2.delete(r2Key).catch(() => undefined)
    throw e
  }

  return {
    id,
    messageId,
    filename,
    contentType,
    sizeBytes: input.bytes.byteLength,
    createdAt,
  }
}

/** Link pending (or reassign) attachment ids to a message, enforcing limits. */
export async function linkAttachmentsToMessage(
  db: D1Database,
  messageId: string,
  attachmentIds: string[],
): Promise<AttachmentMeta[]> {
  const rows = await getAttachmentsByIds(db, attachmentIds)
  if (rows.length !== attachmentIds.length) {
    throw new AttachmentNotFoundError()
  }

  for (const row of rows) {
    if (row.message_id && row.message_id !== messageId) {
      throw new AttachmentLimitError('Attachment already linked to another message')
    }
  }

  const current = await sumSizeForMessage(db, messageId)
  const pending = rows.filter((r) => r.message_id !== messageId)
  const addBytes = pending.reduce((n, r) => n + r.size_bytes, 0)
  assertCanAdd(current.count, current.totalBytes, pending.length, addBytes)

  for (const row of pending) {
    await db
      .prepare(`UPDATE attachments SET message_id = ? WHERE id = ?`)
      .bind(messageId, row.id)
      .run()
  }

  return listAttachmentsForMessage(db, messageId)
}

export async function deleteAttachment(
  db: D1Database,
  r2: R2Bucket,
  id: string,
): Promise<boolean> {
  const row = await getAttachment(db, id)
  if (!row) return false
  await db.prepare(`DELETE FROM attachments WHERE id = ?`).bind(id).run()
  await r2.delete(row.r2_key).catch(() => undefined)
  return true
}

/** Delete all attachment rows + R2 objects for the given message ids. */
export async function deleteAttachmentsForMessages(
  db: D1Database,
  r2: R2Bucket | undefined,
  messageIds: string[],
): Promise<void> {
  if (messageIds.length === 0) return
  const placeholders = messageIds.map(() => '?').join(', ')
  const { results } = await db
    .prepare(
      `SELECT id, r2_key FROM attachments WHERE message_id IN (${placeholders})`,
    )
    .bind(...messageIds)
    .all<{ id: string; r2_key: string }>()

  const rows = results ?? []
  if (rows.length === 0) return

  await db
    .prepare(`DELETE FROM attachments WHERE message_id IN (${placeholders})`)
    .bind(...messageIds)
    .run()

  if (r2) {
    await Promise.all(rows.map((r) => r2.delete(r.r2_key).catch(() => undefined)))
  }
}

/** Move all attachments from one message to another (e.g. draft → sent). */
export async function reassignAttachments(
  db: D1Database,
  fromMessageId: string,
  toMessageId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE attachments SET message_id = ? WHERE message_id = ?`)
    .bind(toMessageId, fromMessageId)
    .run()
}

export type InboundAttachmentPart = {
  filename: string | null
  mimeType: string
  content: ArrayBuffer | Uint8Array | string
  encoding?: 'base64' | 'utf8'
}

/**
 * Store inbound parts under messageId. Returns how many were stored and whether any were skipped.
 */
export async function storeInboundAttachments(
  db: D1Database,
  r2: R2Bucket,
  messageId: string,
  parts: InboundAttachmentPart[],
): Promise<{ stored: number; skipped: boolean }> {
  let stored = 0
  let skipped = false
  let totalBytes = 0

  for (const part of parts) {
    if (stored >= MAX_ATTACHMENTS_PER_MESSAGE) {
      skipped = true
      break
    }
    let bytes: Uint8Array
    try {
      bytes = toUint8Array(part.content, part.encoding)
    } catch {
      skipped = true
      continue
    }
    if (bytes.byteLength === 0) {
      skipped = true
      continue
    }
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      skipped = true
      continue
    }
    if (totalBytes + bytes.byteLength > MAX_ATTACHMENTS_TOTAL_BYTES) {
      skipped = true
      break
    }

    try {
      await storeAttachment(db, r2, {
        filename: part.filename ?? 'attachment',
        contentType: part.mimeType,
        bytes,
        messageId,
      })
      stored += 1
      totalBytes += bytes.byteLength
    } catch {
      skipped = true
    }
  }

  if (parts.length > stored) skipped = true
  return { stored, skipped }
}
