import { describe, expect, it, vi } from 'vitest'
import { applyFiltersToMessage, rowToFilter } from '../src/filters/service'
import type { FilterRow } from '../src/filters/service'

describe('rowToFilter', () => {
  it('returns null on corrupt JSON', () => {
    const row: FilterRow = {
      id: 'f1',
      name: 'broken',
      enabled: 1,
      priority: 0,
      match_mode: 'and',
      conditions_json: '{not-json',
      actions_json: '{"setStarred":true}',
      created_at: 1,
    }
    expect(rowToFilter(row)).toBeNull()
  })

  it('returns null when actions invalid', () => {
    const row: FilterRow = {
      id: 'f1',
      name: 'empty-actions',
      enabled: 1,
      priority: 0,
      match_mode: 'and',
      conditions_json: JSON.stringify([{ type: 'from_contains', value: 'x' }]),
      actions_json: '{}',
      created_at: 1,
    }
    expect(rowToFilter(row)).toBeNull()
  })

  it('parses a valid row', () => {
    const row: FilterRow = {
      id: 'f1',
      name: 'ok',
      enabled: 1,
      priority: 2,
      match_mode: 'or',
      conditions_json: JSON.stringify([{ type: 'subject_contains', value: 'hi' }]),
      actions_json: JSON.stringify({ setStarred: true }),
      created_at: 9,
    }
    expect(rowToFilter(row)).toMatchObject({
      id: 'f1',
      matchMode: 'or',
      conditions: [{ type: 'subject_contains', value: 'hi' }],
      actions: { setStarred: true },
    })
  })
})

describe('applyFiltersToMessage', () => {
  it('sets starred, trash with deleted_at, and inserts tags; skips missing tags', async () => {
    const messageRow = {
      id: 'm1',
      alias_id: 'a1',
      from_addr: 'spam@x.com',
      subject: 'buy now',
      text_body: 'sale',
      folder: 'inbox',
    }

    const filterRow = {
      id: 'f1',
      name: 'spam',
      enabled: 1,
      priority: 0,
      match_mode: 'and',
      conditions_json: JSON.stringify([{ type: 'from_contains', value: 'spam' }]),
      actions_json: JSON.stringify({
        setStarred: true,
        moveToTrash: true,
        addTagIds: ['good', 'gone'],
      }),
      created_at: 1,
    }

    const first = vi
      .fn()
      .mockResolvedValueOnce(messageRow) // load message
      .mockResolvedValueOnce({
        id: 'good',
        name: 'Good',
        color: null,
        created_at: 1,
      }) // findTag good
      .mockResolvedValueOnce(null) // findTag gone

    const all = vi.fn().mockResolvedValue({ results: [filterRow] })
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const stmt = { first, all, run, bind: vi.fn() }
    stmt.bind.mockReturnValue(stmt)
    const prepare = vi.fn().mockReturnValue(stmt)
    const db = { prepare } as unknown as D1Database

    await applyFiltersToMessage(db, 'm1')

    const sqls = prepare.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => /SET\s+is_starred\s*=\s*1/i.test(s))).toBe(true)
    expect(sqls.some((s) => /folder\s*=\s*'trash'/.test(s) && /deleted_at/.test(s))).toBe(
      true,
    )
    expect(sqls.some((s) => /INSERT\s+OR\s+IGNORE\s+INTO\s+message_tags/i.test(s))).toBe(
      true,
    )
  })
})
