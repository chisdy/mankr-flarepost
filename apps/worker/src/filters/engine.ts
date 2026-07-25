import type { FilterActions, FilterMatchInput, FilterRule } from './types'
import { evaluateFilter, reduceActions } from './types'

export { evaluateFilter, reduceActions }

export function collectMatchingActions(
  input: FilterMatchInput,
  filters: FilterRule[],
): FilterActions {
  const matched: FilterActions[] = []
  const ordered = [...filters]
    .filter((f) => f.enabled)
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)

  for (const filter of ordered) {
    if (evaluateFilter(input, filter)) {
      matched.push(filter.actions)
    }
  }
  return reduceActions(matched)
}
