type StoredFolder = 'inbox' | 'sent' | 'trash' | 'draft' | 'spam'
export type Folder = StoredFolder | 'archive'

/** Folders holding soft-deleted mail: hidden from search/starred/tag views, purged by retention. */
export type PurgeableFolder = Extract<Folder, 'trash' | 'spam'>
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
  replyToAddrs: string[]
  lastErrorCode: string | null
  tags: MessageTag[]
}

type MessageListRow = {
  id: string
  folder: StoredFolder
  is_archived: number
  from_addr: string
  to_addrs: string
  subject: string
  is_read: number
  is_starred: number
  has_unsupported_attachments: number
  created_at: number
}

type MessageRow = MessageListRow & {
  alias_id: string
  direction: Direction
  reply_to_addrs: string
  text_body: string
  html_body: string | null
  last_error_code: string | null
}

export const FOLDERS: readonly Folder[] = ['inbox', 'archive', 'sent', 'trash', 'draft', 'spam']
export const DEFAULT_LIST_LIMIT = 50
export const MAX_LIST_LIMIT = 100

/** Folders excluded from search, starred, and tag listings. */
const HIDDEN_FOLDERS_SQL = `('trash', 'draft', 'spam')`

const LIST_COLUMNS = [
  'id', 'folder', 'is_archived', 'from_addr', 'to_addrs', 'subject',
  'is_read', 'is_starred', 'has_unsupported_attachments', 'created_at',
]
const LIST_PROJECTION = LIST_COLUMNS.join(', ')
const TAG_LIST_PROJECTION = LIST_COLUMNS.map((column) => `m.${column}`).join(', ')
const DETAIL_PROJECTION = `${LIST_PROJECTION}, alias_id, direction, reply_to_addrs, text_body,
                           html_body, last_error_code`

export class InvalidCursorError extends Error {
  readonly code = 'invalid_cursor' as const

  constructor(message = 'Invalid cursor') {
    super(message)
    this.name = 'InvalidCursorError'
  }
}

/** Restore target: inbound → inbox, outbound → sent. The archive marker survives soft delete. */
export function restoreTargetFolder(
  direction: Direction,
): 'inbox' | 'sent' {
  return direction === 'inbound' ? 'inbox' : 'sent'
}

function mailboxFolder(folder: StoredFolder, archived: number): Folder {
  return folder === 'inbox' && archived === 1 ? 'archive' : folder
}

export function isFolder(value: string): value is Folder {
  return (FOLDERS as readonly string[]).includes(value)
}

export function encodeCursor(createdAt: number, id: string): string {
  const bytes = new TextEncoder().encode(`${createdAt}:${id}`)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) return null
  try {
    const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    )
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

export function rowToListItem(row: MessageListRow, tagIds?: string[]): MessageListItem {
  return {
    id: row.id,
    folder: mailboxFolder(row.folder, row.is_archived),
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
    replyToAddrs: parseToAddrs(row.reply_to_addrs),
    lastErrorCode: row.last_error_code,
    tags,
  }
}

export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIST_LIMIT
  return Math.max(1, Math.min(Math.floor(raw), MAX_LIST_LIMIT))
}

export type ListMessagesOpts = {
  folder?: Folder
  starred?: boolean
  tagId?: string
  limit?: number
  cursor?: string | null
}

function cursorClause(cursor: string | null | undefined, prefix = ''): {
  sql: string
  binds: unknown[]
} {
  if (!cursor) return { sql: '', binds: [] }
  const decoded = decodeCursor(cursor)
  if (!decoded) throw new InvalidCursorError()
  return {
    sql: ` AND (${prefix}created_at, ${prefix}id) < (?, ?)`,
    binds: [decoded.createdAt, decoded.id],
  }
}

export type FolderCounts = {
  inbox: number
  archive: number
  sent: number
  trash: number
  draft: number
  spam: number
  starred: number
}

/** Counts for sidebar nav: per-folder totals plus starred (excluding trash/draft/spam). */
export async function getFolderCounts(db: D1Database): Promise<FolderCounts> {
  const counts: FolderCounts = {
    inbox: 0,
    archive: 0,
    sent: 0,
    trash: 0,
    draft: 0,
    spam: 0,
    starred: 0,
  }

  const { results: folderRows } = await db
    .prepare(
      `SELECT folder, CASE WHEN folder = 'inbox' THEN is_archived ELSE 0 END AS archived,
              COUNT(*) AS cnt
       FROM messages
       GROUP BY folder, archived`,
    )
    .all<{ folder: StoredFolder; archived: number; cnt: number }>()

  for (const row of folderRows ?? []) {
    counts[mailboxFolder(row.folder, row.archived)] = Number(row.cnt) || 0
  }

  const starredRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM messages
       WHERE is_starred = 1
         AND folder NOT IN ${HIDDEN_FOLDERS_SQL}`,
    )
    .first<{ cnt: number }>()

  counts.starred = Number(starredRow?.cnt) || 0
  return counts
}

export async function listMessages(
  db: D1Database,
  opts: ListMessagesOpts,
): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
  const limit = clampLimit(opts.limit)
  const fetchLimit = limit + 1
  const cursor = cursorClause(opts.cursor, opts.tagId && !opts.starred ? 'm.' : '')
  let results: MessageListRow[]

  if (opts.starred) {
    const { results: rows } = await db
      .prepare(
        `SELECT ${LIST_PROJECTION}
         FROM messages
         WHERE is_starred = 1
           AND folder NOT IN ${HIDDEN_FOLDERS_SQL}
           ${cursor.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(...cursor.binds, fetchLimit)
      .all<MessageListRow>()
    results = rows ?? []
  } else if (opts.tagId) {
    const { results: rows } = await db
      .prepare(
        `SELECT ${TAG_LIST_PROJECTION}
         FROM messages m
         INNER JOIN message_tags mt ON mt.message_id = m.id
         WHERE mt.tag_id = ?
           AND m.folder NOT IN ${HIDDEN_FOLDERS_SQL}
           ${cursor.sql}
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ?`,
      )
      .bind(opts.tagId, ...cursor.binds, fetchLimit)
      .all<MessageListRow>()
    results = rows ?? []
  } else {
    const folder = opts.folder ?? 'inbox'
    const isInboxFolder = folder === 'inbox' || folder === 'archive'
    const folderFilter = isInboxFolder ? "folder = 'inbox' AND is_archived = ?" : 'folder = ?'
    const { results: rows } = await db
      .prepare(
        `SELECT ${LIST_PROJECTION}
         FROM messages
         WHERE ${folderFilter}
           ${cursor.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(isInboxFolder ? Number(folder === 'archive') : folder, ...cursor.binds, fetchLimit)
      .all<MessageListRow>()
    results = rows ?? []
  }

  return toListPage(db, results, limit)
}

const MAX_SEARCH_QUERY = 100

/** Escape `%`, `_`, and `\` for SQLite LIKE with ESCAPE '\'. */
export function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1')
}

export type SearchMessagesOpts = {
  query: string
  from?: string
  aliasId?: string
  tagId?: string
  afterMs?: number
  beforeMsExclusive?: number
  read?: boolean
  limit?: number
  cursor?: string | null
}

/** Search subject / from / text body (LIKE). Excludes trash, drafts, and spam. */
export async function searchMessages(
  db: D1Database,
  opts: SearchMessagesOpts,
): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
  const raw = opts.query.trim().slice(0, MAX_SEARCH_QUERY)
  const from = opts.from?.trim().slice(0, 320)
  const filters: string[] = []
  const binds: (string | number)[] = []
  if (raw) {
    const pattern = `%${escapeLikePattern(raw)}%`
    filters.push(`(subject LIKE ? ESCAPE '\\' OR from_addr LIKE ? ESCAPE '\\'
                   OR text_body LIKE ? ESCAPE '\\')`)
    binds.push(pattern, pattern, pattern)
  }
  if (from) {
    filters.push(`from_addr LIKE ? ESCAPE '\\'`)
    binds.push(`%${escapeLikePattern(from)}%`)
  }
  if (opts.aliasId) {
    filters.push('alias_id = ?')
    binds.push(opts.aliasId)
  }
  if (opts.tagId) {
    filters.push('id IN (SELECT message_id FROM message_tags WHERE tag_id = ?)')
    binds.push(opts.tagId)
  }
  if (opts.afterMs !== undefined) {
    filters.push('created_at >= ?')
    binds.push(opts.afterMs)
  }
  if (opts.beforeMsExclusive !== undefined) {
    filters.push('created_at < ?')
    binds.push(opts.beforeMsExclusive)
  }
  if (opts.read !== undefined) {
    filters.push('is_read = ?')
    binds.push(Number(opts.read))
  }
  if (filters.length === 0) {
    return { items: [], nextCursor: null }
  }

  const limit = clampLimit(opts.limit)
  const cursor = cursorClause(opts.cursor)

  const { results: rows } = await db
    .prepare(
      `SELECT ${LIST_PROJECTION}
       FROM messages
       WHERE folder NOT IN ${HIDDEN_FOLDERS_SQL}
         AND ${filters.join(' AND ')}
         ${cursor.sql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(...binds, ...cursor.binds, limit + 1)
    .all<MessageListRow>()

  return toListPage(db, rows ?? [], limit)
}

async function toListPage(db: D1Database, results: MessageListRow[], limit: number) {
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
    .prepare(`SELECT ${DETAIL_PROJECTION} FROM messages WHERE id = ?`)
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

/**
 * Move to trash or spam and stamp `deleted_at`, which starts the retention clock.
 * Already in the target folder is a no-op so the clock is not extended.
 */
async function moveToPurgeableFolder(
  db: D1Database,
  id: string,
  target: PurgeableFolder,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id, folder FROM messages WHERE id = ?')
    .bind(id)
    .first<{ id: string; folder: StoredFolder }>()
  if (!row || row.folder === 'draft') return false
  if (row.folder === target) return true

  const result = await db
    .prepare('UPDATE messages SET folder = ?, deleted_at = ? WHERE id = ?')
    .bind(target, Date.now(), id)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export function moveToTrash(db: D1Database, id: string): Promise<boolean> {
  return moveToPurgeableFolder(db, id, 'trash')
}

export function moveToSpam(db: D1Database, id: string): Promise<boolean> {
  return moveToPurgeableFolder(db, id, 'spam')
}

export async function restoreMessage(
  db: D1Database,
  id: string,
): Promise<{ folder: Exclude<Folder, 'trash' | 'draft' | 'spam'> } | null> {
  const row = await db
    .prepare('SELECT id, folder, direction, is_archived FROM messages WHERE id = ?')
    .bind(id)
    .first<{ id: string; folder: StoredFolder; direction: Direction; is_archived: number }>()

  if (!row || (row.folder !== 'trash' && row.folder !== 'spam')) return null

  const folder = restoreTargetFolder(row.direction)
  const result = await db
    .prepare(`UPDATE messages SET folder = ?, deleted_at = NULL
              WHERE id = ? AND folder IN ('trash', 'spam')`)
    .bind(folder, id)
    .run()

  if (!result.meta.changes) return null
  return { folder: folder === 'inbox' && row.is_archived === 1 ? 'archive' : folder }
}

/** Guard for draft-only operations: `messages.id` is shared across folders. */
export async function isDraft(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM messages WHERE id = ? AND folder = 'draft'`)
    .bind(id)
    .first<{ id: string }>()
  return row !== null
}

/** Delete message_tags for the folder's messages, then the messages themselves (FK-safe). */
async function emptyFolder(db: D1Database, folder: PurgeableFolder): Promise<number> {
  await db
    .prepare(
      `DELETE FROM message_tags
       WHERE message_id IN (SELECT id FROM messages WHERE folder = ?)`,
    )
    .bind(folder)
    .run()
  const result = await db.prepare('DELETE FROM messages WHERE folder = ?').bind(folder).run()
  return result.meta.changes ?? 0
}

export function emptyTrash(db: D1Database): Promise<number> {
  return emptyFolder(db, 'trash')
}

export function emptySpam(db: D1Database): Promise<number> {
  return emptyFolder(db, 'spam')
}

export const DAY_MS = 24 * 60 * 60 * 1000

export type RetentionDays = {
  trashDays: number
  spamDays: number
}

/** Tags then messages, per folder — the pair D1 runs as one transaction in `batch`. */
function purgeFolderStatements(
  db: D1Database,
  folder: PurgeableFolder,
  cutoff: number,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `DELETE FROM message_tags
         WHERE message_id IN (
           SELECT id FROM messages
           WHERE folder = ? AND deleted_at IS NOT NULL AND deleted_at < ?
         )`,
      )
      .bind(folder, cutoff),
    db
      .prepare(
        `DELETE FROM messages
         WHERE folder = ? AND deleted_at IS NOT NULL AND deleted_at < ?`,
      )
      .bind(folder, cutoff),
  ]
}

export function purgeExpiredStatements(
  db: D1Database,
  retention: RetentionDays,
  now: number = Date.now(),
): D1PreparedStatement[] {
  return [
    ...purgeFolderStatements(db, 'trash', now - retention.trashDays * DAY_MS),
    ...purgeFolderStatements(db, 'spam', now - retention.spamDays * DAY_MS),
    db.prepare('DELETE FROM message_move_undo WHERE expires_at <= ?').bind(now),
  ]
}

/** Hard-delete messages soft-deleted longer ago than their folder's retention window. */
export async function purgeExpiredMessages(
  db: D1Database,
  retention: RetentionDays,
  now: number = Date.now(),
): Promise<{ trash: number; spam: number }> {
  const results = await db.batch(purgeExpiredStatements(db, retention, now))
  return {
    trash: results[1]?.meta.changes ?? 0,
    spam: results[3]?.meta.changes ?? 0,
  }
}

export type InsertInboundMessageInput = {
  aliasId: string
  fromAddr: string
  toAddrs: string[]
  replyToAddrs?: string[]
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
         text_body, html_body, is_read, is_starred, has_unsupported_attachments, created_at,
         reply_to_addrs
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
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
      JSON.stringify(input.replyToAddrs ?? []),
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

export function prepareOutboundMessage(
  db: D1Database,
  input: InsertOutboundMessageInput,
  id: string,
  createdAt: number,
): D1PreparedStatement {
  return db
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
}

/** Insert a successfully sent message into the sent folder. */
export async function insertOutboundMessage(
  db: D1Database,
  input: InsertOutboundMessageInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  await prepareOutboundMessage(db, input, id, Date.now()).run()
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
