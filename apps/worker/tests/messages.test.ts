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
    has_unsupported_attachments: 0,
    last_error_code: null,
    created_at: 1000,
    deleted_at: null,
    ...overrides,
  }
}

describe('listMessages', () => {
  it('queries by folder ordered by created_at DESC with limit+1', async () => {
    const rows = [mockMessageRow(), mockMessageRow({ id: 'm2', created_at: 900 })]
    const all = vi.fn().mockResolvedValue({ results: rows })
    const bind = vi.fn().mockReturnValue({ all })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    const result = await listMessages(db, { folder: 'inbox', limit: 20 })

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      id: 'm1',
      folder: 'inbox',
      fromAddr: 'sender@example.com',
      toAddrs: ['me@example.com'],
      subject: 'Hello',
      isRead: false,
      hasUnsupportedAttachments: false,
      createdAt: 1000,
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
    const all = vi.fn().mockResolvedValue({ results: rows })
    const bind = vi.fn().mockReturnValue({ all })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    const result = await listMessages(db, { folder: 'sent', limit: 2 })
    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).toBe(encodeCursor(999, 'm1'))
  })
})

describe('getMessage', () => {
  it('returns detail shape including bodies and direction', async () => {
    const row = mockMessageRow({ last_error_code: 'rate_limited' })
    const first = vi.fn().mockResolvedValue(row)
    const bind = vi.fn().mockReturnValue({ first })
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
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 }, success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    expect(await moveToTrash(db, 'm1')).toBe(true)
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/SET\s+folder\s*=\s*'trash'/i)
    expect(sql).toMatch(/deleted_at\s*=\s*\?/i)
    expect(bind.mock.calls[0]?.[0]).toEqual(expect.any(Number))
    expect(bind.mock.calls[0]?.[1]).toBe('m1')
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

  it('emptyTrash physically deletes all trash rows', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 3 }, success: true })
    const prepare = vi.fn().mockReturnValue({ run })
    const db = { prepare } as unknown as D1Database

    expect(await emptyTrash(db)).toBe(3)
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toMatch(/DELETE\s+FROM\s+messages\s+WHERE\s+folder\s*=\s*'trash'/i)
  })
})

describe('messages routes auth', () => {
  it('returns 401 without session cookie', async () => {
    const app = createApp()
    const env = {
      DB: {} as D1Database,
      ASSETS: {} as Fetcher,
      COOKIES_SECRET: 'test-secret-at-least-32-chars!!',
      SEND_CHANNEL: 'cloudflare',
      EMAIL_DOMAIN: 'example.com',
    } satisfies Env

    const res = await app.request('http://localhost/api/messages?folder=inbox', {}, env)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' })
  })
})
