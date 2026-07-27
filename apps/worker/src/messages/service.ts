export type Folder = 'inbox' | 'sent' | 'trash' | 'draft'
export type Direction = 'inbound' | 'outbound'

export type MessageTag = {
  id: string
  name: string
  color: string | null
}

export type MessageListItem = {
  id: string
  folder: Folder
  fromAddr: string
  toAddrs: string[]
  subject: string
  isRead: boolean
  isStarred: boolean
  hasUnsupportedAttachments: boolean
  createdAt: number
  tagIds?: string[]
}

export type MessageDetail = MessageListItem & {
  textBody: string
  htmlBody: string | null
  aliasId: string
  direction: Direction
  lastErrorCode: string | null
  tags: MessageTag[]
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
  is_starred: number
  has_unsupported_attachments: number
  last_error_code: string | null
  created_at: number
  deleted_at: number | null
}

export const FOLDERS: readonly Folder[] = ['inbox', 'sent', 'trash', 'draft'] as const
export const DEFAULT_LIST_LIMIT = 50
export const MAX_LIST_LIMIT = 100

const MESSAGE_COLUMNS = `id, alias_id, folder, direction, from_addr, to_addrs, subject,
                text_body, html_body, is_read, is_starred, has_unsupported_attachments,
                last_error_code, created_at, deleted_at`

export class InvalidCursorError extends Error {
  readonly code = 'invalid_cursor' as const

  constructor(message = 'Invalid cursor') {
    super(message)
    this.name = 'InvalidCursorError'
  }
}

/** Restore target: inbound → inbox, outbound → sent. Drafts are hard-deleted, not trashed. */
export function restoreTargetFolder(direction: Direction): Exclude<Folder, 'trash' | 'draft'> {
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

export function rowToListItem(row: MessageRow, tagIds?: string[]): MessageListItem {
  return {
    id: row.id,
    folder: row.folder,
    fromAddr: row.from_addr,
    toAddrs: parseToAddrs(row.to_addrs),
    subject: row.subject,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
    hasUnsupportedAttachments: row.has_unsupported_attachments === 1,
    createdAt: row.created_at,
    ...(tagIds ? { tagIds } : {}),
  }
}

export function rowToDetail(row: MessageRow, tags: MessageTag[] = []): MessageDetail {
  return {
    ...rowToListItem(row, tags.map((t) => t.id)),
    textBody: row.text_body,
    htmlBody: row.html_body,
    aliasId: row.alias_id,
    direction: row.direction,
    lastErrorCode: row.last_error_code,
    tags,
  }
}

export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIST_LIMIT
  return Math.min(Math.floor(raw), MAX_LIST_LIMIT)
}

export type ListMessagesOpts = {
  folder?: Folder
  starred?: boolean
  tagId?: string
  limit?: number
  cursor?: string | null
}

function cursorClause(cursor: string | null | undefined): {
  sql: string
  binds: unknown[]
} {
  if (!cursor) return { sql: '', binds: [] }
  const decoded = decodeCursor(cursor)
  if (!decoded) throw new InvalidCursorError()
  return {
    sql: ` AND (created_at < ? OR (created_at = ? AND id < ?))`,
    binds: [decoded.createdAt, decoded.createdAt, decoded.id],
  }
}

export async function listMessages(
  db: D1Database,
  opts: ListMessagesOpts,
): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
  const limit = clampLimit(opts.limit)
  const fetchLimit = limit + 1
  const cursor = cursorClause(opts.cursor)

  let results: MessageRow[]

  if (opts.starred) {
    const { results: rows } = await db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
         FROM messages
         WHERE is_starred = 1
           AND folder NOT IN ('trash', 'draft')
           ${cursor.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(...cursor.binds, fetchLimit)
      .all<MessageRow>()
    results = rows ?? []
  } else if (opts.tagId) {
    const tagCursorSql = cursor.sql
      ? ` AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))`
      : ''
    const { results: rows } = await db
      .prepare(
        `SELECT m.id, m.alias_id, m.folder, m.direction, m.from_addr, m.to_addrs, m.subject,
                m.text_body, m.html_body, m.is_read, m.is_starred, m.has_unsupported_attachments,
                m.last_error_code, m.created_at, m.deleted_at
         FROM messages m
         INNER JOIN message_tags mt ON mt.message_id = m.id
         WHERE mt.tag_id = ?
           AND m.folder NOT IN ('trash', 'draft')
           ${tagCursorSql}
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ?`,
      )
      .bind(opts.tagId, ...cursor.binds, fetchLimit)
      .all<MessageRow>()
    results = rows ?? []
  } else {
    const folder = opts.folder ?? 'inbox'
    const { results: rows } = await db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
         FROM messages
         WHERE folder = ?
           ${cursor.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(folder, ...cursor.binds, fetchLimit)
      .all<MessageRow>()
    results = rows ?? []
  }

  const hasMore = results.length > limit
  const page = hasMore ? results.slice(0, limit) : results
  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

  const tagIdsByMessage = await loadTagIdsForMessages(
    db,
    page.map((r) => r.id),
  )

  return {
    items: page.map((row) => rowToListItem(row, tagIdsByMessage.get(row.id) ?? [])),
    nextCursor,
  }
}

const MAX_SEARCH_QUERY = 100

/** Escape `%`, `_`, and `\` for SQLite LIKE with ESCAPE '\'. */
export function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1')
}

export type SearchMessagesOpts = {
  query: string
  limit?: number
  cursor?: string | null
}

/** Search subject / from / text body (LIKE). Excludes trash and drafts. */
export async function searchMessages(
  db: D1Database,
  opts: SearchMessagesOpts,
): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
  const raw = opts.query.trim().slice(0, MAX_SEARCH_QUERY)
  if (!raw) {
    return { items: [], nextCursor: null }
  }

  const limit = clampLimit(opts.limit)
  const fetchLimit = limit + 1
  const cursor = cursorClause(opts.cursor)
  const pattern = `%${escapeLikePattern(raw)}%`

  const { results: rows } = await db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages
       WHERE folder NOT IN ('trash', 'draft')
         AND (
           subject LIKE ? ESCAPE '\\'
           OR from_addr LIKE ? ESCAPE '\\'
           OR text_body LIKE ? ESCAPE '\\'
         )
         ${cursor.sql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(pattern, pattern, pattern, ...cursor.binds, fetchLimit)
    .all<MessageRow>()

  const results = rows ?? []
  const hasMore = results.length > limit
  const page = hasMore ? results.slice(0, limit) : results
  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

  const tagIdsByMessage = await loadTagIdsForMessages(
    db,
    page.map((r) => r.id),
  )

  return {
    items: page.map((row) => rowToListItem(row, tagIdsByMessage.get(row.id) ?? [])),
    nextCursor,
  }
}

async function loadTagIdsForMessages(
  db: D1Database,
  messageIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (messageIds.length === 0) return map

  const placeholders = messageIds.map(() => '?').join(', ')
  const { results } = await db
    .prepare(
      `SELECT message_id, tag_id FROM message_tags WHERE message_id IN (${placeholders})`,
    )
    .bind(...messageIds)
    .all<{ message_id: string; tag_id: string }>()

  for (const row of results ?? []) {
    const list = map.get(row.message_id) ?? []
    list.push(row.tag_id)
    map.set(row.message_id, list)
  }
  return map
}

export async function loadTagsForMessage(
  db: D1Database,
  messageId: string,
): Promise<MessageTag[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.color
       FROM tags t
       INNER JOIN message_tags mt ON mt.tag_id = t.id
       WHERE mt.message_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(messageId)
    .all<{ id: string; name: string; color: string | null }>()
  return (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
  }))
}

export async function getMessage(db: D1Database, id: string): Promise<MessageDetail | null> {
  const row = await db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`)
    .bind(id)
    .first<MessageRow>()
  if (!row) return null
  const tags = await loadTagsForMessage(db, id)
  return rowToDetail(row, tags)
}

export async function setStarred(
  db: D1Database,
  id: string,
  starred: boolean,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE messages SET is_starred = ? WHERE id = ?')
    .bind(starred ? 1 : 0, id)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function markRead(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE messages SET is_read = 1 WHERE id = ?')
    .bind(id)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function moveToTrash(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id, folder FROM messages WHERE id = ?')
    .bind(id)
    .first<{ id: string; folder: Folder }>()
  if (!row || row.folder === 'draft') return false

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
): Promise<{ folder: Exclude<Folder, 'trash' | 'draft'> } | null> {
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

/** Guard for draft-only operations: `messages.id` is shared across folders. */
export async function isDraft(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM messages WHERE id = ? AND folder = 'draft'`)
    .bind(id)
    .first<{ id: string }>()
  return row !== null
}

/** Delete message_tags for trash messages, then delete trash messages (FK-safe). */
export async function emptyTrash(db: D1Database): Promise<number> {
  await db
    .prepare(
      `DELETE FROM message_tags
       WHERE message_id IN (SELECT id FROM messages WHERE folder = 'trash')`,
    )
    .run()
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
         text_body, html_body, is_read, is_starred, has_unsupported_attachments, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
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
         text_body, html_body, is_read, is_starred, has_unsupported_attachments,
         provider_message_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
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

export type UpsertDraftInput = {
  aliasId: string
  fromAddr: string
  toAddrs: string[]
  subject: string
  textBody: string
  htmlBody?: string | null
}

/** Create a new draft message. */
export async function insertDraft(
  db: D1Database,
  input: UpsertDraftInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  await db
    .prepare(
      `INSERT INTO messages (
         id, alias_id, folder, direction, from_addr, to_addrs, subject,
         text_body, html_body, is_read, is_starred, has_unsupported_attachments, created_at
       ) VALUES (?, ?, 'draft', 'outbound', ?, ?, ?, ?, ?, 1, 0, 0, ?)`,
    )
    .bind(
      id,
      input.aliasId,
      input.fromAddr,
      JSON.stringify(input.toAddrs),
      input.subject,
      input.textBody,
      input.htmlBody ?? null,
      createdAt,
    )
    .run()
  return { id }
}

/** Update an existing draft. Returns false if not found or not a draft. */
export async function updateDraft(
  db: D1Database,
  id: string,
  input: UpsertDraftInput,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE messages
       SET alias_id = ?, from_addr = ?, to_addrs = ?, subject = ?,
           text_body = ?, html_body = ?, created_at = ?
       WHERE id = ? AND folder = 'draft'`,
    )
    .bind(
      input.aliasId,
      input.fromAddr,
      JSON.stringify(input.toAddrs),
      input.subject,
      input.textBody,
      input.htmlBody ?? null,
      Date.now(),
      id,
    )
    .run()
  return (result.meta.changes ?? 0) > 0
}

/** Hard-delete a draft (and its tags). Returns false if not found or not a draft. */
export async function deleteDraft(db: D1Database, id: string): Promise<boolean> {
  await db.prepare(`DELETE FROM message_tags WHERE message_id = ?`).bind(id).run()
  const result = await db
    .prepare(`DELETE FROM messages WHERE id = ? AND folder = 'draft'`)
    .bind(id)
    .run()
  return (result.meta.changes ?? 0) > 0
}
