import { describe, expect, it, vi } from 'vitest'
import {
  MAX_TAGS,
  InvalidTagError,
  assertCanCreateTag,
  createTag,
  normalizeTagColor,
  normalizeTagName,
  setMessageTags,
  TagLimitError,
} from '../src/tags/service'

describe('normalizeTagName', () => {
  it('trims and truncates', () => {
    expect(normalizeTagName('  Work  ')).toBe('Work')
    expect(normalizeTagName('x'.repeat(50)).length).toBe(40)
  })
})

describe('normalizeTagColor', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(normalizeTagColor('#AbC')).toBe('#abc')
    expect(normalizeTagColor('#a1b2c3')).toBe('#a1b2c3')
  })

  it('rejects non-hex and returns null for empty', () => {
    expect(normalizeTagColor(null)).toBeNull()
    expect(normalizeTagColor('')).toBeNull()
    expect(() => normalizeTagColor('red')).toThrow(InvalidTagError)
    expect(() => normalizeTagColor('#gg0000')).toThrow(InvalidTagError)
    expect(() => normalizeTagColor('javascript:alert(1)')).toThrow(InvalidTagError)
  })
})

describe('assertCanCreateTag', () => {
  it('throws when at limit', async () => {
    const first = vi.fn().mockResolvedValue({ c: MAX_TAGS })
    const prepare = vi.fn().mockReturnValue({ first })
    const db = { prepare } as unknown as D1Database
    await expect(assertCanCreateTag(db)).rejects.toBeInstanceOf(TagLimitError)
  })
})

describe('createTag', () => {
  it('inserts a tag', async () => {
    const first = vi.fn().mockResolvedValue({ c: 0 })
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const stmt = { first, run, bind: vi.fn() }
    stmt.bind.mockReturnValue(stmt)
    const prepare = vi.fn().mockReturnValue(stmt)
    const db = { prepare } as unknown as D1Database

    const tag = await createTag(db, { name: ' Inbox ', color: '#ABC' })
    expect(tag.name).toBe('Inbox')
    expect(tag.color).toBe('#abc')
    expect(tag.id).toMatch(/^[0-9a-f-]{36}$/i)
  })
})

describe('setMessageTags', () => {
  it('returns empty when message missing', async () => {
    const first = vi.fn().mockResolvedValue(null)
    const bind = vi.fn().mockReturnValue({ first })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database
    await expect(setMessageTags(db, 'missing', ['t1'])).resolves.toEqual([])
  })

  it('replaces tags skipping unknown ids via IN query', async () => {
    const first = vi.fn().mockResolvedValueOnce({ id: 'm1' })
    const all = vi.fn().mockResolvedValue({ results: [{ id: 't1' }] })
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const stmt = { first, all, run, bind: vi.fn() }
    stmt.bind.mockReturnValue(stmt)
    const prepare = vi.fn().mockReturnValue(stmt)
    const db = { prepare } as unknown as D1Database

    const ids = await setMessageTags(db, 'm1', ['t1', 'bad'])
    expect(ids).toEqual(['t1'])
    const sqls = prepare.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => /WHERE\s+id\s+IN/i.test(s))).toBe(true)
    expect(sqls.some((s) => /DELETE\s+FROM\s+message_tags/i.test(s))).toBe(true)
  })
})
