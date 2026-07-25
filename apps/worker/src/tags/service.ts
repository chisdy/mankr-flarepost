export const MAX_TAGS = 50
export const MAX_TAG_NAME_LENGTH = 40

export type Tag = {
  id: string
  name: string
  color: string | null
  createdAt: number
}

export type TagRow = {
  id: string
  name: string
  color: string | null
  created_at: number
}

export class TagLimitError extends Error {
  readonly code = 'tag_limit' as const
  constructor(message = 'Tag limit reached') {
    super(message)
    this.name = 'TagLimitError'
  }
}

export class InvalidTagError extends Error {
  readonly code = 'invalid_tag' as const
  constructor(message = 'Invalid tag') {
    super(message)
    this.name = 'InvalidTagError'
  }
}

export function normalizeTagName(raw: string): string {
  return raw.trim().slice(0, MAX_TAG_NAME_LENGTH)
}

/** Accept only #RGB or #RRGGBB (case-insensitive). */
export function normalizeTagColor(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    throw new InvalidTagError('invalid color')
  }
  return trimmed.toLowerCase()
}

export function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  }
}

export async function countTags(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM tags')
    .first<{ c: number }>()
  return row?.c ?? 0
}

export async function assertCanCreateTag(db: D1Database): Promise<void> {
  const count = await countTags(db)
  if (count >= MAX_TAGS) throw new TagLimitError()
}

export async function listTags(db: D1Database): Promise<Tag[]> {
  const { results } = await db
    .prepare('SELECT id, name, color, created_at FROM tags ORDER BY name ASC')
    .all<TagRow>()
  return (results ?? []).map(rowToTag)
}

export async function findTagById(db: D1Database, id: string): Promise<Tag | null> {
  const row = await db
    .prepare('SELECT id, name, color, created_at FROM tags WHERE id = ?')
    .bind(id)
    .first<TagRow>()
  return row ? rowToTag(row) : null
}

export async function createTag(
  db: D1Database,
  input: { name: string; color?: string | null },
): Promise<Tag> {
  const name = normalizeTagName(input.name)
  if (!name) throw new InvalidTagError('empty name')
  await assertCanCreateTag(db)

  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const color = normalizeTagColor(input.color ?? null)

  try {
    await db
      .prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, name, color, createdAt)
      .run()
  } catch (e) {
    if (e instanceof InvalidTagError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (/UNIQUE/i.test(msg)) throw new InvalidTagError('duplicate name')
    throw e
  }

  return { id, name, color, createdAt }
}

export async function updateTag(
  db: D1Database,
  id: string,
  input: { name?: string; color?: string | null },
): Promise<Tag | null> {
  const existing = await findTagById(db, id)
  if (!existing) return null

  const name =
    input.name !== undefined ? normalizeTagName(input.name) : existing.name
  if (!name) throw new InvalidTagError('empty name')

  const color =
    input.color === undefined
      ? existing.color
      : normalizeTagColor(input.color)

  try {
    await db
      .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
      .bind(name, color, id)
      .run()
  } catch (e) {
    if (e instanceof InvalidTagError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (/UNIQUE/i.test(msg)) throw new InvalidTagError('duplicate name')
    throw e
  }

  return { id, name, color, createdAt: existing.createdAt }
}

export async function deleteTag(db: D1Database, id: string): Promise<boolean> {
  await db.prepare('DELETE FROM message_tags WHERE tag_id = ?').bind(id).run()
  const result = await db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run()
  return (result.meta.changes ?? 0) > 0
}

/** Replace all tags on a message. Unknown tag IDs are ignored. */
export async function setMessageTags(
  db: D1Database,
  messageId: string,
  tagIds: string[],
): Promise<string[]> {
  const msg = await db
    .prepare('SELECT id FROM messages WHERE id = ?')
    .bind(messageId)
    .first<{ id: string }>()
  if (!msg) return []

  const unique = [...new Set(tagIds.filter(Boolean))]
  let valid: string[] = []
  if (unique.length > 0) {
    const placeholders = unique.map(() => '?').join(', ')
    const { results } = await db
      .prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`)
      .bind(...unique)
      .all<{ id: string }>()
    const found = new Set((results ?? []).map((r) => r.id))
    valid = unique.filter((id) => found.has(id))
  }

  await db.prepare('DELETE FROM message_tags WHERE message_id = ?').bind(messageId).run()
  for (const tagId of valid) {
    await db
      .prepare('INSERT INTO message_tags (message_id, tag_id) VALUES (?, ?)')
      .bind(messageId, tagId)
      .run()
  }
  return valid
}

export async function messageExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM messages WHERE id = ?')
    .bind(id)
    .first<{ id: string }>()
  return Boolean(row)
}
