export type MatchMode = 'and' | 'or'

export type FilterCondition =
  | { type: 'from_contains'; value: string }
  | { type: 'to_alias_id'; value: string }
  | { type: 'subject_contains'; value: string }
  | { type: 'body_contains'; value: string }

export type FilterActions = {
  addTagIds?: string[]
  setStarred?: true
  moveToTrash?: true
  moveToSpam?: true
}

export type FilterRule = {
  id: string
  name: string
  enabled: boolean
  priority: number
  matchMode: MatchMode
  conditions: FilterCondition[]
  actions: FilterActions
  createdAt: number
}

export type FilterMatchInput = {
  aliasId: string
  fromAddr: string
  subject: string
  textBody: string
}

const CONDITION_TYPES = new Set([
  'from_contains',
  'to_alias_id',
  'subject_contains',
  'body_contains',
])

export function isMatchMode(value: unknown): value is MatchMode {
  return value === 'and' || value === 'or'
}

export const MAX_CONDITION_VALUE_LENGTH = 200

export function parseConditions(raw: unknown): FilterCondition[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: FilterCondition[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const type = (item as { type?: unknown }).type
    const value = (item as { value?: unknown }).value
    if (typeof type !== 'string' || !CONDITION_TYPES.has(type)) return null
    if (typeof value !== 'string' || !value.trim()) return null
    const trimmed = value.trim().slice(0, MAX_CONDITION_VALUE_LENGTH)
    if (!trimmed) return null
    out.push({ type: type as FilterCondition['type'], value: trimmed })
  }
  return out
}

export function parseActions(raw: unknown): FilterActions | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const actions: FilterActions = {}
  let hasAction = false

  if ('addTagIds' in obj) {
    if (!Array.isArray(obj.addTagIds) || !obj.addTagIds.every((x) => typeof x === 'string')) {
      return null
    }
    const ids = [...new Set(obj.addTagIds.map((x) => x.trim()).filter(Boolean))]
    if (ids.length > 0) {
      actions.addTagIds = ids
      hasAction = true
    }
  }
  if ('setStarred' in obj) {
    if (obj.setStarred !== true) return null
    actions.setStarred = true
    hasAction = true
  }
  if ('moveToTrash' in obj) {
    if (obj.moveToTrash !== true) return null
    actions.moveToTrash = true
    hasAction = true
  }
  if ('moveToSpam' in obj) {
    if (obj.moveToSpam !== true) return null
    actions.moveToSpam = true
    hasAction = true
  }

  // Spam wins over trash: a rule that says both would otherwise depend on apply order.
  if (actions.moveToSpam) delete actions.moveToTrash

  return hasAction ? actions : null
}

function containsInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export function matchCondition(input: FilterMatchInput, condition: FilterCondition): boolean {
  switch (condition.type) {
    case 'from_contains':
      return containsInsensitive(input.fromAddr, condition.value)
    case 'to_alias_id':
      return input.aliasId === condition.value
    case 'subject_contains':
      return containsInsensitive(input.subject, condition.value)
    case 'body_contains':
      return containsInsensitive(input.textBody, condition.value)
    default:
      return false
  }
}

export function evaluateFilter(
  input: FilterMatchInput,
  filter: Pick<FilterRule, 'matchMode' | 'conditions'>,
): boolean {
  if (filter.conditions.length === 0) return false
  if (filter.matchMode === 'and') {
    return filter.conditions.every((c) => matchCondition(input, c))
  }
  return filter.conditions.some((c) => matchCondition(input, c))
}

/** Merge stacked filter actions (later rules add tags; flags OR together). */
export function reduceActions(actionsList: FilterActions[]): FilterActions {
  const tagIds = new Set<string>()
  let setStarred: true | undefined
  let moveToTrash: true | undefined
  let moveToSpam: true | undefined

  for (const actions of actionsList) {
    for (const id of actions.addTagIds ?? []) tagIds.add(id)
    if (actions.setStarred) setStarred = true
    if (actions.moveToTrash) moveToTrash = true
    if (actions.moveToSpam) moveToSpam = true
  }

  const out: FilterActions = {}
  if (tagIds.size > 0) out.addTagIds = [...tagIds]
  if (setStarred) out.setStarred = true
  // Spam wins when stacked rules ask for both.
  if (moveToSpam) out.moveToSpam = true
  else if (moveToTrash) out.moveToTrash = true
  return out
}
