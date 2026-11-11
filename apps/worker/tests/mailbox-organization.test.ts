import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import type { Env } from '../src/env'
import { createApp } from '../src/http/app'
import { bulkUpdateMessages, MAX_BULK_MESSAGES, undoBulkMove } from '../src/messages/bulk'
import { getMessage, purgeExpiredMessages, type Folder, type MessageListItem } from '../src/messages/service'
import { sqliteD1 } from './helpers/sqlite-d1'

const app = createApp()
let database: ReturnType<typeof sqliteD1>
let env: Env
let cookie: string
const time = Date.parse('2026-10-22T09:30:00Z')

beforeEach(async () => {
  database = sqliteD1()
  env = {
    DB: database.db,
    ASSETS: {} as Fetcher,
    COOKIES_SECRET: 'test-only-mailbox-organization-secret',
    EMAIL_DOMAIN: 'example.test',
  }
  cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie('admin', env.COOKIES_SECRET)}`
  database.sqlite.exec(`
    INSERT INTO aliases (id, address, created_at) VALUES
      ('main', 'me@example.test', 1), ('other', 'other@example.test', 2);
    INSERT INTO tags (id, name, created_at) VALUES
      ('work', 'Work', 1), ('receipt', 'Receipt', 1);
  `)
})

afterEach(() => database.sqlite.close())

function addMessage(id: string, options: {
  folder?: Exclude<Folder, 'archive'>
  alias?: string
  from?: string
  read?: number
  createdAt?: number
  deletedAt?: number
} = {}) {
  const folder = options.folder ?? 'inbox'
  database.sqlite.prepare(
    `INSERT INTO messages (
       id, alias_id, folder, direction, from_addr, to_addrs, subject,
       text_body, html_body, is_read, created_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, '[]', 'Hello', '账单 %', '<p>账单</p>', ?, ?, ?)`,
  ).run(
    id, options.alias ?? 'main', folder, folder === 'sent' ? 'outbound' : 'inbound',
    options.from ?? 'service@example.test', options.read ?? 0, options.createdAt ?? time,
    options.deletedAt ?? null,
  )
}

function request(path: string, body?: unknown) {
  return app.request(`http://localhost/api/messages${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env)
}

async function bulk(ids: string[], action: string, tagId?: string) {
  const response = await request('/bulk', { ids, action, tagId })
  expect(response.status).toBe(200)
  return response.json() as Promise<{ changed: number; undoToken?: string }>
}

async function page(path: string) {
  const response = await request(path)
  expect(response.status).toBe(200)
  return response.json() as Promise<{ items: MessageListItem[]; nextCursor: string | null }>
}

describe('archive and reversible bulk changes', () => {
  it('counts archive separately and preserves it when restoring a trashed archived message', async () => {
    addMessage('inbox')
    addMessage('archive')
    addMessage('sent', { folder: 'sent', read: 1 })
    const archived = await bulk(['archive', 'sent', 'archive'], 'archive')
    expect(archived).toMatchObject({ changed: 1, undoToken: expect.any(String) })
    expect((await page('?folder=inbox')).items.map((item) => item.id)).toEqual(['inbox'])
    expect((await page('?folder=archive')).items).toMatchObject([{ id: 'archive', folder: 'archive' }])
    await expect((await request('/counts')).json()).resolves.toMatchObject({ inbox: 1, archive: 1, sent: 1 })

    await bulk(['archive', 'sent'], 'trash')
    await expect((await request('/archive/restore', {})).json()).resolves.toEqual({
      ok: true, folder: 'archive',
    })
    await expect((await request('/sent/restore', {})).json()).resolves.toEqual({
      ok: true, folder: 'sent',
    })
    const movedBack = await bulk(['archive'], 'unarchive')
    expect((await page('?folder=archive')).items).toEqual([])
    await expect((await request('/bulk/undo', { undoToken: movedBack.undoToken })).json())
      .resolves.toEqual({ changed: 1 })
    expect((await page('?folder=archive')).items).toMatchObject([{ id: 'archive' }])
  })

  it('undoes only unchanged moves and never overwrites newer read and tag edits', async () => {
    addMessage('unchanged')
    addMessage('moved-again')
    addMessage('spam', { folder: 'spam', deletedAt: time })
    const { undoToken } = await bulk(['unchanged', 'moved-again', 'spam'], 'trash')
    await bulk(['unchanged'], 'read')
    await bulk(['unchanged'], 'tag', 'work')
    await request('/moved-again/restore', {})
    await bulk(['moved-again'], 'trash')

    const undone = await request('/bulk/undo', { undoToken })
    await expect(undone.json()).resolves.toEqual({ changed: 2 })
    await expect(getMessage(env.DB, 'unchanged')).resolves.toMatchObject({
      folder: 'inbox', isRead: true, tagIds: ['work'],
    })
    await expect(getMessage(env.DB, 'moved-again')).resolves.toMatchObject({ folder: 'trash' })
    expect(database.sqlite.prepare("SELECT folder, deleted_at FROM messages WHERE id = 'spam'").get())
      .toMatchObject({ folder: 'spam', deleted_at: time })
    await expect((await request('/bulk/undo', { undoToken })).json()).resolves.toEqual({ changed: 0 })
  })

  it('cannot undo an expired move and retention cleanup removes expired snapshots', async () => {
    addMessage('inbox')
    const { undoToken } = await bulkUpdateMessages(env.DB, ['inbox'], 'archive', undefined, time)
    expect(undoToken).toBeDefined()
    await expect(undoBulkMove(env.DB, undoToken!, time + 300_000)).resolves.toEqual({ changed: 0 })
    await bulkUpdateMessages(env.DB, ['inbox'], 'unarchive', undefined, time)
    await purgeExpiredMessages(env.DB, { trashDays: 30, spamDays: 30 }, time + 300_001)
    expect(database.sqlite.prepare('SELECT * FROM message_move_undo').all()).toEqual([])
  })

  it('adds tags without replacing existing ones and rejects oversized or malformed batches', async () => {
    addMessage('inbox')
    addMessage('sent', { folder: 'sent', read: 1 })
    addMessage('draft', { folder: 'draft' })
    await expect(bulk(['inbox'], 'tag', 'work')).resolves.toEqual({ changed: 1 })
    await expect(bulk(['inbox', 'sent', 'draft'], 'tag', 'receipt')).resolves.toEqual({ changed: 2 })
    await expect(bulk(['inbox', 'sent'], 'tag', 'receipt')).resolves.toEqual({ changed: 0 })
    await expect(bulk(['inbox', 'sent'], 'unread')).resolves.toEqual({ changed: 1 })
    await expect(getMessage(env.DB, 'inbox')).resolves.toMatchObject({ tagIds: ['receipt', 'work'] })
    await expect(getMessage(env.DB, 'sent')).resolves.toMatchObject({ tagIds: ['receipt'], isRead: false })
    expect((await request('/bulk', { ids: Array(MAX_BULK_MESSAGES + 1).fill('inbox'), action: 'trash' })).status).toBe(400)
    expect((await request('/bulk', { ids: ['inbox', null], action: 'trash' })).status).toBe(400)
    await expect(getMessage(env.DB, 'inbox')).resolves.toMatchObject({ folder: 'inbox' })
  })
})

describe('combined mailbox search', () => {
  it('combines filters and stable cursors, includes archive, and keeps bodies out of results', async () => {
    addMessage('m1')
    addMessage('m2')
    addMessage('wrong-alias', { alias: 'other' })
    addMessage('wrong-sender', { from: 'person@example.test' })
    addMessage('wrong-date', { createdAt: Date.parse('2026-10-23T00:00:00Z') })
    addMessage('already-read', { read: 1 })
    addMessage('hidden', { folder: 'trash' })
    addMessage('not-tagged')
    await bulk(['m2'], 'archive')
    await bulk(['m1', 'm2', 'wrong-alias', 'wrong-sender', 'wrong-date', 'already-read', 'hidden'], 'tag', 'work')

    const filters = 'from=SERVICE&aliasId=main&after=2026-10-22&before=2026-10-22&read=0&tagId=work'
    expect((await page(`/search?${filters}`)).items.map((item) => item.id)).toEqual(['m2', 'm1'])
    const query = `/search?${filters}&limit=1&q=${encodeURIComponent('账单 %')}`
    const first = await page(query)
    expect(first.items).toMatchObject([{ id: 'm2', folder: 'archive' }])
    expect(first.items[0]).not.toHaveProperty('htmlBody')
    expect(first.items[0]).not.toHaveProperty('textBody')
    expect(first.nextCursor).toBeTruthy()
    const second = await page(`${query}&cursor=${first.nextCursor}`)
    expect(second.items).toMatchObject([{ id: 'm1', folder: 'inbox' }])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects impossible dates, inverted ranges, and invalid read filters', async () => {
    expect((await request('/search?after=2026-02-30')).status).toBe(400)
    expect((await request('/search?after=2026-04-12&before=2026-04-11')).status).toBe(400)
    expect((await request('/search?read=maybe')).status).toBe(400)
  })
})
