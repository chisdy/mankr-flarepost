import { collectMatchingActions } from './engine'
import {
  isMatchMode,
  parseActions,
  parseConditions,
  type FilterActions,
  type FilterCondition,
  type FilterRule,
  type MatchMode,
} from './types'
import { findTagById } from '../tags/service'

export type FilterRow = {
  id: string
  name: string
  enabled: number
  priority: number
  match_mode: MatchMode
  conditions_json: string
  actions_json: string
  created_at: number
}

export class InvalidFilterError extends Error {
  readonly code = 'invalid_filter' as const
  constructor(message = 'Invalid filter') {
    super(message)
    this.name = 'InvalidFilterError'
  }
}

/** Parse a DB row; returns null if JSON is corrupt or fails validation. */
export function rowToFilter(row: FilterRow): FilterRule | null {
  let conditionsRaw: unknown
  let actionsRaw: unknown
  try {
    conditionsRaw = JSON.parse(row.conditions_json) as unknown
    actionsRaw = JSON.parse(row.actions_json) as unknown
  } catch {
    return null
  }

  const conditions = parseConditions(conditionsRaw)
  const actions = parseActions(actionsRaw)
  if (!conditions || !actions) return null
  if (row.match_mode !== 'and' && row.match_mode !== 'or') return null

  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    priority: row.priority,
    matchMode: row.match_mode,
    conditions,
    actions,
    createdAt: row.created_at,
  }
}

function mapFilterRows(rows: FilterRow[] | null | undefined): FilterRule[] {
  const out: FilterRule[] = []
  for (const row of rows ?? []) {
    const parsed = rowToFilter(row)
    if (parsed) out.push(parsed)
  }
  return out
}

export async function listFilters(db: D1Database): Promise<FilterRule[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, enabled, priority, match_mode, conditions_json, actions_json, created_at
       FROM filters
       ORDER BY priority ASC, created_at ASC`,
    )
    .all<FilterRow>()
  return mapFilterRows(results)
}

export async function listEnabledOrdered(db: D1Database): Promise<FilterRule[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, enabled, priority, match_mode, conditions_json, actions_json, created_at
       FROM filters
       WHERE enabled = 1
       ORDER BY priority ASC, created_at ASC`,
    )
    .all<FilterRow>()
  return mapFilterRows(results)
}

export async function findFilterById(
  db: D1Database,
  id: string,
): Promise<FilterRule | null> {
  const row = await db
    .prepare(
      `SELECT id, name, enabled, priority, match_mode, conditions_json, actions_json, created_at
       FROM filters WHERE id = ?`,
    )
    .bind(id)
    .first<FilterRow>()
  return row ? rowToFilter(row) : null
}

async function assertTagIdsExist(db: D1Database, tagIds: string[] | undefined): Promise<void> {
  if (!tagIds?.length) return
  for (const tagId of tagIds) {
    const tag = await findTagById(db, tagId)
    if (!tag) throw new InvalidFilterError(`unknown tag ${tagId}`)
  }
}

export type UpsertFilterInput = {
  name: string
  enabled?: boolean
  priority?: number
  matchMode: MatchMode
  conditions: FilterCondition[]
  actions: FilterActions
}

export function validateFilterPayload(body: {
  name?: unknown
  enabled?: unknown
  priority?: unknown
  matchMode?: unknown
  conditions?: unknown
  actions?: unknown
}): UpsertFilterInput {
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw new InvalidFilterError('name required')
  }
  if (!isMatchMode(body.matchMode)) {
    throw new InvalidFilterError('invalid matchMode')
  }
  const conditions = parseConditions(body.conditions)
  if (!conditions) throw new InvalidFilterError('invalid conditions')
  const actions = parseActions(body.actions)
  if (!actions) throw new InvalidFilterError('invalid actions')

  let enabled = true
  if ('enabled' in body && body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new InvalidFilterError('invalid enabled')
    enabled = body.enabled
  }

  let priority = 0
  if ('priority' in body && body.priority !== undefined) {
    if (typeof body.priority !== 'number' || !Number.isFinite(body.priority)) {
      throw new InvalidFilterError('invalid priority')
    }
    priority = Math.floor(body.priority)
  }

  return {
    name: body.name.trim().slice(0, 80),
    enabled,
    priority,
    matchMode: body.matchMode,
    conditions,
    actions,
  }
}

export async function createFilter(
  db: D1Database,
  input: UpsertFilterInput,
): Promise<FilterRule> {
  await assertTagIdsExist(db, input.actions.addTagIds)
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  await db
    .prepare(
      `INSERT INTO filters (
         id, name, enabled, priority, match_mode, conditions_json, actions_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.enabled === false ? 0 : 1,
      input.priority ?? 0,
      input.matchMode,
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      createdAt,
    )
    .run()

  return {
    id,
    name: input.name,
    enabled: input.enabled !== false,
    priority: input.priority ?? 0,
    matchMode: input.matchMode,
    conditions: input.conditions,
    actions: input.actions,
    createdAt,
  }
}

export async function updateFilter(
  db: D1Database,
  id: string,
  input: UpsertFilterInput,
): Promise<FilterRule | null> {
  const existing = await findFilterById(db, id)
  if (!existing) return null
  await assertTagIdsExist(db, input.actions.addTagIds)

  await db
    .prepare(
      `UPDATE filters
       SET name = ?, enabled = ?, priority = ?, match_mode = ?,
           conditions_json = ?, actions_json = ?
       WHERE id = ?`,
    )
    .bind(
      input.name,
      input.enabled === false ? 0 : 1,
      input.priority ?? 0,
      input.matchMode,
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      id,
    )
    .run()

  return {
    id,
    name: input.name,
    enabled: input.enabled !== false,
    priority: input.priority ?? 0,
    matchMode: input.matchMode,
    conditions: input.conditions,
    actions: input.actions,
    createdAt: existing.createdAt,
  }
}

export async function deleteFilter(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM filters WHERE id = ?').bind(id).run()
  return (result.meta.changes ?? 0) > 0
}

/**
 * Apply enabled filters to a newly inserted message.
 * Missing tag IDs are skipped. Trash and spam set folder + deleted_at.
 */
export async function applyFiltersToMessage(
  db: D1Database,
  messageId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT id, alias_id, from_addr, subject, text_body, folder
       FROM messages WHERE id = ?`,
    )
    .bind(messageId)
    .first<{
      id: string
      alias_id: string
      from_addr: string
      subject: string
      text_body: string
      folder: string
    }>()
  if (!row) return

  const filters = await listEnabledOrdered(db)
  if (filters.length === 0) return

  const actions = collectMatchingActions(
    {
      aliasId: row.alias_id,
      fromAddr: row.from_addr,
      subject: row.subject,
      textBody: row.text_body,
    },
    filters,
  )

  if (
    !actions.addTagIds?.length &&
    !actions.setStarred &&
    !actions.moveToTrash &&
    !actions.moveToSpam
  ) {
    return
  }

  if (actions.setStarred) {
    await db.prepare('UPDATE messages SET is_starred = 1 WHERE id = ?').bind(messageId).run()
  }

  const targetFolder = actions.moveToSpam ? 'spam' : actions.moveToTrash ? 'trash' : null
  if (targetFolder && row.folder !== targetFolder) {
    await db
      .prepare('UPDATE messages SET folder = ?, deleted_at = ? WHERE id = ?')
      .bind(targetFolder, Date.now(), messageId)
      .run()
  }

  for (const tagId of actions.addTagIds ?? []) {
    const tag = await findTagById(db, tagId)
    if (!tag) continue
    try {
      await db
        .prepare(
          `INSERT OR IGNORE INTO message_tags (message_id, tag_id) VALUES (?, ?)`,
        )
        .bind(messageId, tagId)
        .run()
    } catch {
      // skip insert failures for missing tags / races
    }
  }
}
