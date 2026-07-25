import { describe, expect, it } from 'vitest'
import { collectMatchingActions } from '../src/filters/engine'
import {
  evaluateFilter,
  parseActions,
  parseConditions,
  reduceActions,
} from '../src/filters/types'
import type { FilterRule } from '../src/filters/types'

const baseInput = {
  aliasId: 'alias-1',
  fromAddr: 'Boss@Example.com',
  subject: 'Urgent invoice',
  textBody: 'Please pay by Friday',
}

describe('parseConditions / parseActions', () => {
  it('parses valid conditions', () => {
    expect(
      parseConditions([
        { type: 'from_contains', value: ' boss ' },
        { type: 'body_contains', value: 'pay' },
      ]),
    ).toEqual([
      { type: 'from_contains', value: 'boss' },
      { type: 'body_contains', value: 'pay' },
    ])
  })

  it('rejects values longer than max after trim', () => {
    const long = 'a'.repeat(250)
    const parsed = parseConditions([{ type: 'body_contains', value: long }])
    expect(parsed?.[0]?.value.length).toBe(200)
  })

  it('rejects empty conditions', () => {
    expect(parseConditions([])).toBeNull()
  })

  it('requires at least one action', () => {
    expect(parseActions({})).toBeNull()
    expect(parseActions({ setStarred: true })).toEqual({ setStarred: true })
  })
})

describe('evaluateFilter', () => {
  it('AND requires all conditions', () => {
    expect(
      evaluateFilter(baseInput, {
        matchMode: 'and',
        conditions: [
          { type: 'from_contains', value: 'boss' },
          { type: 'subject_contains', value: 'missing' },
        ],
      }),
    ).toBe(false)
    expect(
      evaluateFilter(baseInput, {
        matchMode: 'and',
        conditions: [
          { type: 'from_contains', value: 'boss' },
          { type: 'body_contains', value: 'friday' },
        ],
      }),
    ).toBe(true)
  })

  it('OR matches any condition', () => {
    expect(
      evaluateFilter(baseInput, {
        matchMode: 'or',
        conditions: [
          { type: 'subject_contains', value: 'nope' },
          { type: 'to_alias_id', value: 'alias-1' },
        ],
      }),
    ).toBe(true)
  })
})

describe('reduceActions / collectMatchingActions', () => {
  it('stacks trash + star + tags across matching rules by priority', () => {
    const filters: FilterRule[] = [
      {
        id: 'f2',
        name: 'star',
        enabled: true,
        priority: 20,
        matchMode: 'and',
        conditions: [{ type: 'from_contains', value: 'boss' }],
        actions: { setStarred: true, addTagIds: ['t2'] },
        createdAt: 2,
      },
      {
        id: 'f1',
        name: 'trash',
        enabled: true,
        priority: 10,
        matchMode: 'and',
        conditions: [{ type: 'subject_contains', value: 'urgent' }],
        actions: { moveToTrash: true, addTagIds: ['t1'] },
        createdAt: 1,
      },
      {
        id: 'f3',
        name: 'disabled',
        enabled: false,
        priority: 5,
        matchMode: 'and',
        conditions: [{ type: 'from_contains', value: 'boss' }],
        actions: { addTagIds: ['ignored'] },
        createdAt: 3,
      },
    ]

    const actions = collectMatchingActions(baseInput, filters)
    expect(actions).toEqual({
      addTagIds: ['t1', 't2'],
      setStarred: true,
      moveToTrash: true,
    })
  })

  it('reduceActions unions tags', () => {
    expect(
      reduceActions([{ addTagIds: ['a'] }, { addTagIds: ['a', 'b'], setStarred: true }]),
    ).toEqual({ addTagIds: ['a', 'b'], setStarred: true })
  })
})
