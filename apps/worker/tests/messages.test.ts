import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/http/app'
import type { Env } from '../src/env'
import {
  decodeCursor,
  encodeCursor,
  listMessages,
  markRead,
  moveToTrash,
  restoreMessage,
  restoreTargetFolder,
  emptyTrash,
  getMessage,
  insertDraft,
  updateDraft,
  deleteDraft,
  setStarred,
  escapeLikePattern,
  searchMessages,
} from '../src/messages/service'

describe('restoreTargetFolder', () => {
  it('maps inbound trash → inbox', () => {
    expect(restoreTargetFolder('inbound')).toBe('inbox')
  })

  it('maps outbound trash → sent', () => {
    expect(restoreTargetFolder('outbound')).toBe('sent')
  })
})

describe('cursor encode/decode', () => {
  it('round-trips createdAt and id', () => {
    const cursor = encodeCursor(1_700_000_000_000, 'msg-abc')
    expect(decodeCursor(cursor)).toEqual({ createdAt: 1_700_000_000_000, id: 'msg-abc' })
  })

  it('rejects malformed cursor', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })
})

function mockMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    alias_id: 'a1',
    folder: 'inbox',
    direction: 'inbound',
    from_addr: 'sender@example.com',
    to_addrs: '["me@example.com"]',
    subject: 'Hello',
    text_body: 'body',
    html_body: '<p>body</p>',
    is_read: 0,
    is_starred: 0,
    has_unsupported_attachments: 0,
    last_error_code: null,
    created_at: 1000,
    deleted_at: null,
    ...overrides,
  }
}

function mockDbForList(rows: ReturnType<typeof mockMessageRow>[]) {
  const all = vi
    .fn()
    .mockResolvedValueOnce({ results: rows })
    .mockResolvedValue({ results: [] })
  const bind = vi.fn().mockReturnValue({ all })
  const prepare = vi.fn().mockReturnValue({ bind })
  return { prepare, bind, all, db: { prepare } as unknown as D1Database }
}

describe('listMessages', () => {
  it('queries by folder ordered by created_at DESC with limit+1', async () => {
    const rows = [mockMessageRow(), mockMessageRow({ id: 'm2', created_at: 900 })]
    const { prepare, bind, db } = mockDbForList(rows)

    const result = await listMessages(db, { folder: 'inbox', limit: 20 })

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      id: 'm1',
      folder: 'inbox',
      fromAddr: 'sender@example.com',
      toAddrs: ['me@example.com'],
      subject: 'Hello',
      isRead: false,
      isStarred: false,
      hasUnsupportedAttachments: false,
      createdAt: 1000,
      tagIds: [],
    })
    expect(result.nextCursor).toBeNull()
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/WHERE\s+folder\s*=\s*\?/i)
    expect(sql).toMatch(/ORDER BY\s+created_at\s+DESC\s*,\s*id\s+DESC/i)
    expect(bind).toHaveBeenCalledWith('inbox', 21)
  })

  it('returns nextCursor when more than limit rows', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      mockMessageRow({ id: `m${i}`, created_at: 1000 - i }),
    )
    const { db } = mockDbForList(rows)

    const result = await listMessages(db, { folder: 'sent', limit: 2 })
    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).toBe(encodeCursor(999, 'm1'))
  })

  it('lists starred messages excluding trash and draft', async () => {
    const rows = [mockMessageRow({ is_starred: 1 })]
    const { prepare, bind, db } = mockDbForList(rows)

    const result = await listMessages(db, { starred: true, limit: 10 })
    expect(result.items[0]?.isStarred).toBe(true)
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/is_starred\s*=\s*1/i)
    expect(sql).toMatch(/folder\s+NOT\s+IN\s*\(\s*'trash'\s*,\s*'draft'\s*\)/i)
    expect(bind).toHaveBeenCalledWith(11)
  })

  it('lists by tagId via join', async () => {
    const rows = [mockMessageRow()]
    const { prepare, bind, db } = mockDbForList(rows)

    await listMessages(db, { tagId: 'tag-1', limit: 10 })
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/INNER\s+JOIN\s+message_tags/i)
    expect(bind).toHaveBeenCalledWith('tag-1', 11)
  })
})

describe('getMessage', () => {
  it('returns detail shape including bodies and direction', async () => {
    const row = mockMessageRow({ last_error_code: 'rate_limited', is_starred: 1 })
    const first = vi.fn().mockResolvedValue(row)
    const all = vi.fn().mockResolvedValue({
      results: [{ id: 't1', name: 'Work', color: '#000' }],
    })
    const bind = vi.fn().mockReturnValue({ first, all })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    const msg = await getMessage(db, 'm1')
    expect(msg).toMatchObject({
      id: 'm1',
      aliasId: 'a1',
      direction: 'inbound',
      textBody: 'body',
      htmlBody: '<p>body</p>',
      lastErrorCode: 'rate_limited',
      isStarred: true,
      tags: [{ id: 't1', name: 'Work', color: '#000' }],
    })
  })

  it('returns null when missing', async () => {
    const first = vi.fn().mockResolvedValue(null)
    const bind = vi.fn().mockReturnValue({ first })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database
    await expect(getMessage(db, 'missing')).resolves.toBeNull()
  })
})

describe('folder actions', () => {
  it('markRead updates is_read=1', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    expect(await markRead(db, 'm1')).toBe(true)
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/UPDATE\s+messages\s+SET\s+is_read\s*=\s*1\s+WHERE\s+id\s*=\s*\?/i)
    expect(bind).toHaveBeenCalledWith('m1')
  })

  it('moveToTrash sets folder=trash and deleted_at', async () => {
    const first = vi.fn().mockResolvedValue({ id: 'm1', folder: 'inbox' })
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ first, run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    expect(await moveToTrash(db, 'm1')).toBe(true)
    const selectSql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(selectSql).toMatch(/SELECT\s+id,\s*folder\s+FROM\s+messages/i)
    const updateSql = String(prepare.mock.calls[1]?.[0] ?? '')
    expect(updateSql).toMatch(/SET\s+folder\s*=\s*'trash'/i)
    expect(updateSql).toMatch(/deleted_at\s*=\s*\?/i)
    expect(bind.mock.calls[1]?.[0]).toEqual(expect.any(Number))
    expect(bind.mock.calls[1]?.[1]).toBe('m1')
  })

  it('moveToTrash refuses drafts', async () => {
    const first = vi.fn().mockResolvedValue({ id: 'd1', folder: 'draft' })
    const bind = vi.fn().mockReturnValue({ first })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    await expect(moveToTrash(db, 'd1')).resolves.toBe(false)
  })

  it('restoreMessage uses direction mapping and clears deleted_at', async () => {
    const first = vi.fn().mockResolvedValue({ id: 'm1', folder: 'trash', direction: 'outbound' })
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ first, run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    const restored = await restoreMessage(db, 'm1')
    expect(restored).toEqual({ folder: 'sent' })
    const updateSql = String(prepare.mock.calls[1]?.[0] ?? '')
    expect(updateSql).toMatch(/SET\s+folder\s*=\s*\?\s*,\s*deleted_at\s*=\s*NULL/i)
    expect(bind).toHaveBeenCalledWith('sent', 'm1')
  })

  it('restoreMessage returns null when not in trash', async () => {
    const first = vi.fn().mockResolvedValue({ id: 'm1', folder: 'inbox', direction: 'inbound' })
    const bind = vi.fn().mockReturnValue({ first })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    await expect(restoreMessage(db, 'm1')).resolves.toBeNull()
  })

  it('emptyTrash deletes message_tags, then trash messages', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ meta: { changes: 2 }, success: true })
      .mockResolvedValueOnce({ meta: { changes: 3 }, success: true })
    const prepare = vi.fn().mockReturnValue({ run })
    const db = { prepare } as unknown as D1Database

    expect(await emptyTrash(db)).toBe(3)
    const tagSql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(tagSql).toMatch(/DELETE\s+FROM\s+message_tags/i)
    const msgSql = String(prepare.mock.calls[1]?.[0] ?? '')
    expect(msgSql).toMatch(/DELETE\s+FROM\s+messages\s+WHERE\s+folder\s*=\s*'trash'/i)
  })
})

describe('setStarred', () => {
  it('updates is_starred', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    expect(await setStarred(db, 'm1', true)).toBe(true)
    expect(bind).toHaveBeenCalledWith(1, 'm1')
  })
})

describe('drafts', () => {
  it('insertDraft writes folder=draft outbound', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    const result = await insertDraft(db, {
      aliasId: 'a1',
      fromAddr: 'me@example.com',
      toAddrs: ['you@example.com'],
      subject: 'Draft',
      textBody: 'hello',
    })
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i)
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/folder,\s*direction/)
    expect(sql).toMatch(/'draft',\s*'outbound'/)
    expect(bind.mock.calls[0]?.[1]).toBe('a1')
    expect(bind.mock.calls[0]?.[2]).toBe('me@example.com')
    expect(bind.mock.calls[0]?.[3]).toBe(JSON.stringify(['you@example.com']))
  })

  it('updateDraft only touches draft rows', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    expect(
      await updateDraft(db, 'd1', {
        aliasId: 'a1',
        fromAddr: 'me@example.com',
        toAddrs: [],
        subject: 'Updated',
        textBody: 'body',
      }),
    ).toBe(true)
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/WHERE\s+id\s*=\s*\?\s+AND\s+folder\s*=\s*'draft'/i)
  })

  it('deleteDraft removes message_tags, then draft row', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ meta: { changes: 1 }, success: true })
      .mockResolvedValueOnce({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    expect(await deleteDraft(db, 'd1')).toBe(true)
    const tagSql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(tagSql).toMatch(/DELETE\s+FROM\s+message_tags\s+WHERE\s+message_id\s*=\s*\?/i)
    const sql = String(prepare.mock.calls[1]?.[0] ?? '')
    expect(sql).toMatch(/DELETE\s+FROM\s+messages\s+WHERE\s+id\s*=\s*\?\s+AND\s+folder\s*=\s*'draft'/i)
    expect(bind).toHaveBeenCalledWith('d1')
  })
})

describe('messages routes auth', () => {
  it('returns 401 without session cookie', async () => {
    const app = createApp()
    const env = {
      DB: {} as D1Database,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: 'test-secret-at-least-32-chars!!',
      EMAIL_DOMAIN: 'example.com',
    } satisfies Env

    const res = await app.request('http://localhost/api/messages?folder=inbox', {}, env)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' })
  })
})

describe('escapeLikePattern', () => {
  it('escapes %, _, and backslash', () => {
    expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
  })
})

describe('searchMessages', () => {
  it('returns empty for blank query without querying', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    const result = await searchMessages(db, { query: '   ' })
    expect(result).toEqual({ items: [], nextCursor: null })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('searches subject/from/body excluding trash and draft', async () => {
    const rows = [mockMessageRow({ subject: 'Invoice April' })]
    const { prepare, bind, db } = mockDbForList(rows)

    const result = await searchMessages(db, { query: 'Invoice', limit: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.subject).toBe('Invoice April')
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/folder\s+NOT\s+IN\s*\(\s*'trash'\s*,\s*'draft'\s*\)/i)
    expect(sql).toMatch(/subject\s+LIKE\s+\?\s+ESCAPE/i)
    expect(sql).toMatch(/from_addr\s+LIKE\s+\?\s+ESCAPE/i)
    expect(sql).toMatch(/text_body\s+LIKE\s+\?\s+ESCAPE/i)
    expect(bind).toHaveBeenCalledWith('%Invoice%', '%Invoice%', '%Invoice%', 21)
  })
})
