export const MAX_BULK_MESSAGES = 50
const UNDO_WINDOW_MS = 5 * 60 * 1000

type MoveAction = 'archive' | 'unarchive' | 'trash'
export type BulkAction = MoveAction | 'read' | 'unread' | 'tag'

export function isBulkAction(value: unknown): value is BulkAction {
  return value === 'read' || value === 'unread' || value === 'tag' ||
    value === 'archive' || value === 'unarchive' || value === 'trash'
}

type BulkResult = { changed: number; undoToken?: string }

export async function bulkUpdateMessages(
  db: D1Database,
  ids: string[],
  action: BulkAction,
  tagId?: string,
  now: number = Date.now(),
): Promise<BulkResult> {
  if (ids.length === 0 || ids.length > MAX_BULK_MESSAGES) {
    throw new RangeError('Invalid batch size')
  }
  const placeholders = ids.map(() => '?').join(', ')

  if (action === 'read' || action === 'unread') {
    const read = Number(action === 'read')
    const result = await db
      .prepare(
        `UPDATE messages SET is_read = ?
         WHERE id IN (${placeholders}) AND folder <> 'draft' AND is_read <> ?`,
      )
      .bind(read, ...ids, read)
      .run()
    return { changed: result.meta.changes ?? 0 }
  }

  if (action === 'tag') {
    if (!tagId) throw new TypeError('Missing tag ID')
    const result = await db
      .prepare(
        `INSERT INTO message_tags (message_id, tag_id)
         SELECT id, ? FROM messages
         WHERE id IN (${placeholders}) AND folder <> 'draft'
           AND EXISTS (SELECT 1 FROM tags WHERE id = ?)
         ON CONFLICT(message_id, tag_id) DO NOTHING`,
      )
      .bind(tagId, ...ids, tagId)
      .run()
    return { changed: result.meta.changes ?? 0 }
  }

  const token = crypto.randomUUID()
  const eligible = action === 'trash'
    ? "folder NOT IN ('trash', 'draft')"
    : `folder = 'inbox' AND is_archived = ${Number(action === 'unarchive')}`
  const set = action === 'trash'
    ? "folder = 'trash', deleted_at = ?"
    : `is_archived = ${Number(action === 'archive')}`
  const [result] = await db.batch([
    // The snapshot and move commit together. The trigger stores the next
    // revision, so even moving away and back invalidates this undo token.
    db.prepare(
      `INSERT INTO message_move_undo (
         token, message_id, previous_folder, previous_archive, previous_deleted_at, revision, expires_at
       )
       SELECT ?, id, folder, is_archived, deleted_at, move_revision + 1, ?
       FROM messages WHERE id IN (${placeholders}) AND ${eligible}`,
    ).bind(token, now + UNDO_WINDOW_MS, ...ids),
    db.prepare(
      `UPDATE messages SET ${set}
       WHERE id IN (SELECT message_id FROM message_move_undo WHERE token = ?)`,
    ).bind(...(action === 'trash' ? [now, token] : [token])),
  ])
  const changed = result?.meta.changes ?? 0
  return changed > 0 ? { changed, undoToken: token } : { changed }
}

export async function undoBulkMove(
  db: D1Database,
  token: string,
  now: number = Date.now(),
): Promise<{ changed: number }> {
  const [result] = await db.batch<{ id: string }>([
    db.prepare(
      `UPDATE messages
       SET (folder, is_archived, deleted_at) = (
         SELECT previous_folder, previous_archive, previous_deleted_at
         FROM message_move_undo WHERE token = ? AND message_id = messages.id
       )
       WHERE (id, move_revision) IN (
         SELECT message_id, revision FROM message_move_undo WHERE token = ? AND expires_at > ?
       )
       RETURNING id`,
    ).bind(token, token, now),
    db.prepare('DELETE FROM message_move_undo WHERE token = ?').bind(token),
  ])
  // D1 metadata also counts trigger writes. Count only the messages returned.
  return { changed: result?.results.length ?? 0 }
}
