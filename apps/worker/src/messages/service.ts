export type Folder = 'inbox' | 'sent' | 'trash'
export type Direction = 'inbound' | 'outbound'

export type MessageListItem = {
  id: string
  folder: Folder
  fromAddr: string
  toAddrs: string[]
  subject: string
  isRead: boolean
  hasUnsupportedAttachments: boolean
  createdAt: number
}

export type MessageDetail = MessageListItem & {
  textBody: string
  htmlBody: string | null
  aliasId: string
  direction: Direction
  lastErrorCode: string | null
}

export type MessageRow = {
  id: string
  alias_id: string
  folder: Folder
  direction: Direction
  from_addr: string
  to_addrs: string
  subject: string
  text_body: string
  html_body: string | null
  is_read: number
  has_unsupported_attachments: number
  last_error_code: string | null
  created_at: number
  deleted_at: number | null
}

export const FOLDERS: readonly Folder[] = ['inbox', 'sent', 'trash'] as const
export const DEFAULT_LIST_LIMIT = 50
export const MAX_LIST_LIMIT = 100

export class InvalidFolderError extends Error {
  readonly code = 'invalid_folder' as const

  constructor(message = 'Invalid folder') {
    super(message)
    this.name = 'InvalidFolderError'
  }
}

export class InvalidCursorError extends Error {
  readonly code = 'invalid_cursor' as const

  constructor(message = 'Invalid cursor') {
    super(message)
    this.name = 'InvalidCursorError'
  }
}

/** Restore target: inbound → inbox, outbound → sent. */
export function restoreTargetFolder(direction: Direction): Exclude<Folder, 'trash'> {
  return direction === 'inbound' ? 'inbox' : 'sent'
}

export function isFolder(value: string): value is Folder {
  return (FOLDERS as readonly string[]).includes(value)
}

export function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  if (!cursor) return null
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const sep = raw.indexOf(':')
    if (sep <= 0) return null
    const createdAt = Number(raw.slice(0, sep))
    const id = raw.slice(sep + 1)
    if (!Number.isFinite(createdAt) || !id) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

function parseToAddrs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

export function rowToListItem(row: MessageRow): MessageListItem {
  return {
    id: row.id,
    folder: row.folder,
    fromAddr: row.from_addr,
    toAddrs: parseToAddrs(row.to_addrs),
    subject: row.subject,
    isRead: row.is_read === 1,
    hasUnsupportedAttachments: row.has_unsupported_attachments === 1,
    createdAt: row.created_at,
  }
}

export function rowToDetail(row: MessageRow): MessageDetail {
  return {
    ...rowToListItem(row),
    textBody: row.text_body,
    htmlBody: row.html_body,
    aliasId: row.alias_id,
    direction: row.direction,
    lastErrorCode: row.last_error_code,
  }
}

export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIST_LIMIT
  return Math.min(Math.floor(raw), MAX_LIST_LIMIT)
}

export async function listMessages(
  db: D1Database,
  opts: { folder: Folder; limit?: number; cursor?: string | null },
): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
  const limit = clampLimit(opts.limit)
  const fetchLimit = limit + 1

  let results: MessageRow[]

  if (opts.cursor) {
    const decoded = decodeCursor(opts.cursor)
    if (!decoded) throw new InvalidCursorError()
    const { results: rows } = await db
      .prepare(
        `SELECT id, alias_id, folder, direction, from_addr, to_addrs, subject,
                text_body, html_body, is_read, has_unsupported_attachments,
                last_error_code, created_at, deleted_at
         FROM messages
         WHERE folder = ?
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(opts.folder, decoded.createdAt, decoded.createdAt, decoded.id, fetchLimit)
      .all<MessageRow>()
    results = rows ?? []
  } else {
    const { results: rows } = await db
      .prepare(
        `SELECT id, alias_id, folder, direction, from_addr, to_addrs, subject,
                text_body, html_body, is_read, has_unsupported_attachments,
                last_error_code, created_at, deleted_at
         FROM messages
         WHERE folder = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(opts.folder, fetchLimit)
      .all<MessageRow>()
    results = rows ?? []
  }

  const hasMore = results.length > limit
  const page = hasMore ? results.slice(0, limit) : results
  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

  return {
    items: page.map(rowToListItem),
    nextCursor,
  }
}

export async function getMessage(db: D1Database, id: string): Promise<MessageDetail | null> {
  const row = await db
    .prepare(
      `SELECT id, alias_id, folder, direction, from_addr, to_addrs, subject,
              text_body, html_body, is_read, has_unsupported_attachments,
              last_error_code, created_at, deleted_at
       FROM messages WHERE id = ?`,
    )
    .bind(id)
    .first<MessageRow>()
  return row ? rowToDetail(row) : null
}

export async function markRead(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE messages SET is_read = 1 WHERE id = ?')
    .bind(id)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function moveToTrash(db: D1Database, id: string): Promise<boolean> {
  const deletedAt = Date.now()
  const result = await db
    .prepare(`UPDATE messages SET folder = 'trash', deleted_at = ? WHERE id = ?`)
    .bind(deletedAt, id)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function restoreMessage(
  db: D1Database,
  id: string,
): Promise<{ folder: Exclude<Folder, 'trash'> } | null> {
  const row = await db
    .prepare('SELECT id, folder, direction FROM messages WHERE id = ?')
    .bind(id)
    .first<{ id: string; folder: Folder; direction: Direction }>()

  if (!row || row.folder !== 'trash') return null

  const folder = restoreTargetFolder(row.direction)
  await db
    .prepare('UPDATE messages SET folder = ?, deleted_at = NULL WHERE id = ?')
    .bind(folder, id)
    .run()

  return { folder }
}

export async function emptyTrash(db: D1Database): Promise<number> {
  const result = await db.prepare(`DELETE FROM messages WHERE folder = 'trash'`).run()
  return result.meta.changes ?? 0
}

export type InsertInboundMessageInput = {
  aliasId: string
  fromAddr: string
  toAddrs: string[]
  subject: string
  textBody: string
  htmlBody: string | null
  hasUnsupportedAttachments: boolean
}

/** Insert an inbound message into the inbox folder. */
export async function insertInboundMessage(
  db: D1Database,
  input: InsertInboundMessageInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  await db
    .prepare(
      `INSERT INTO messages (
         id, alias_id, folder, direction, from_addr, to_addrs, subject,
         text_body, html_body, is_read, has_unsupported_attachments, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.aliasId,
      'inbox',
      'inbound',
      input.fromAddr,
      JSON.stringify(input.toAddrs),
      input.subject,
      input.textBody,
      input.htmlBody,
      0,
      input.hasUnsupportedAttachments ? 1 : 0,
      createdAt,
    )
    .run()
  return { id }
}

export type InsertOutboundMessageInput = {
  aliasId: string
  fromAddr: string
  toAddrs: string[]
  subject: string
  textBody: string
  htmlBody: string | null
  providerMessageId: string | null
}

/** Insert a successfully sent message into the sent folder. */
export async function insertOutboundMessage(
  db: D1Database,
  input: InsertOutboundMessageInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  await db
    .prepare(
      `INSERT INTO messages (
         id, alias_id, folder, direction, from_addr, to_addrs, subject,
         text_body, html_body, is_read, has_unsupported_attachments,
         provider_message_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.aliasId,
      'sent',
      'outbound',
      input.fromAddr,
      JSON.stringify(input.toAddrs),
      input.subject,
      input.textBody,
      input.htmlBody,
      1,
      0,
      input.providerMessageId,
      createdAt,
    )
    .run()
  return { id }
}
