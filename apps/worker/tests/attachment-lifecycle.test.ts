import { describe, expect, it, vi } from 'vitest'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import type { Env } from '../src/env'
import { createApp } from '../src/http/app'

const SECRET = 'test-secret-at-least-32-chars!!'
// https://developers.cloudflare.com/d1/platform/limits/
const D1_MAX_BOUND_PARAMS = 100

type QueryResult = { rows?: unknown[]; changes?: number }
type QueryHandler = (sql: string, params: unknown[]) => QueryResult

/** Minimal D1 fake that enforces the platform's bound-parameter limit. */
function fakeD1(handler: QueryHandler) {
  const statements: string[] = []
  const prepare = (sql: string) => {
    statements.push(sql)
    const withParams = (params: unknown[]) => {
      const exec = (): QueryResult => {
        if (params.length > D1_MAX_BOUND_PARAMS) {
          throw new Error(`D1_ERROR: too many SQL variables (${params.length})`)
        }
        return handler(sql, params)
      }
      return {
        bind: (...next: unknown[]) => withParams([...params, ...next]),
        all: async () => ({ results: exec().rows ?? [] }),
        first: async () => (exec().rows ?? [])[0] ?? null,
        run: async () => ({ meta: { changes: exec().changes ?? 0 }, success: true }),
      }
    }
    return withParams([])
  }
  return { statements, db: { prepare } as unknown as D1Database }
}

function fakeR2() {
  const deleted: string[] = []
  const del = vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) deleted.push(key)
  })
  const get = vi.fn(async () => null)
  return { deleted, del, get, bucket: { delete: del, get } as unknown as R2Bucket }
}

function makeEnv(db: D1Database, attachments?: R2Bucket): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    COOKIES_SECRET: SECRET,
    SEND_CHANNEL: 'resend',
    EMAIL_DOMAIN: 'example.com',
    RESEND_API_KEY: 'test-key',
    ATTACHMENTS: attachments,
  } as Env
}

async function sessionCookie() {
  return `${SESSION_COOKIE_NAME}=${await createSessionCookie('user-1', SECRET)}`
}

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-1',
    message_id: 'm-inbox',
    r2_key: 'att/2026/att-1',
    filename: 'secret.pdf',
    content_type: 'application/pdf',
    size_bytes: 10,
    created_at: 1000,
    ...overrides,
  }
}

function inboxRow() {
  return {
    id: 'm-inbox',
    alias_id: 'a1',
    folder: 'inbox',
    direction: 'inbound',
    from_addr: 'sender@example.com',
    to_addrs: '["me@example.com"]',
    subject: 'Invoice',
    text_body: 'body',
    html_body: null,
    is_read: 0,
    is_starred: 0,
    has_unsupported_attachments: 0,
    last_error_code: null,
    created_at: 1000,
    deleted_at: null,
  }
}

describe('DELETE /api/messages/trash', () => {
  it('empties a trash larger than the D1 bound-parameter limit', async () => {
    const size = D1_MAX_BOUND_PARAMS + 50
    const keys = Array.from({ length: size }, (_, i) => `att/2026/key-${i}`)
    const { db } = fakeD1((sql) => {
      if (/r2_key/i.test(sql) && /^SELECT/i.test(sql)) {
        return { rows: keys.map((key, i) => ({ id: `att-${i}`, r2_key: key })) }
      }
      if (/^SELECT\s+id\s+FROM\s+messages/i.test(sql)) {
        return { rows: keys.map((_, i) => ({ id: `m-${i}` })) }
      }
      return { changes: size }
    })
    const r2 = fakeR2()
    const cookie = await sessionCookie()

    const res = await app().request(
      'http://localhost/api/messages/trash',
      { method: 'DELETE', headers: { Cookie: cookie } },
      makeEnv(db, r2.bucket),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ deleted: size })
    // Every attachment's bytes must be removed, in bulk R2 calls rather than one per key.
    expect(r2.deleted).toHaveLength(size)
    expect(r2.del.mock.calls.length).toBeLessThan(size)
  })
})

describe('DELETE /api/messages/drafts/:id', () => {
  it('leaves attachments untouched when the id is not a draft', async () => {
    const { statements, db } = fakeD1((sql) => {
      if (/folder\s*=\s*'draft'/i.test(sql)) return { rows: [], changes: 0 }
      if (/r2_key/i.test(sql)) return { rows: [attachmentRow()] }
      return { changes: 1 }
    })
    const r2 = fakeR2()
    const cookie = await sessionCookie()

    const res = await app().request(
      'http://localhost/api/messages/drafts/m-inbox',
      { method: 'DELETE', headers: { Cookie: cookie } },
      makeEnv(db, r2.bucket),
    )

    expect(res.status).toBe(404)
    expect(r2.deleted).toEqual([])
    expect(statements.some((sql) => /DELETE\s+FROM\s+attachments/i.test(sql))).toBe(false)
  })
})

describe('POST /api/messages/send', () => {
  it('rejects a draftId that points at a non-draft message', async () => {
    const { statements, db } = fakeD1((sql) => {
      if (/FROM\s+aliases/i.test(sql)) {
        return {
          rows: [
            { id: 'a1', address: 'me@example.com', enabled: 1, is_default: 1, created_at: 1 },
          ],
        }
      }
      if (/FROM\s+messages/i.test(sql)) return { rows: [inboxRow()] }
      if (/FROM\s+attachments/i.test(sql)) return { rows: [attachmentRow()] }
      return { rows: [], changes: 0 }
    })
    const r2 = fakeR2()
    const cookie = await sessionCookie()

    const res = await app().request(
      'http://localhost/api/messages/send',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          fromAliasId: 'a1',
          to: ['someone@example.com'],
          subject: 'Hi',
          text: 'body',
          draftId: 'm-inbox',
        }),
      },
      makeEnv(db, r2.bucket),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_draft' })
    // The other message keeps its attachments, and nothing is sent or deleted.
    expect(statements.some((sql) => /UPDATE\s+attachments\s+SET\s+message_id/i.test(sql))).toBe(
      false,
    )
    expect(statements.some((sql) => /DELETE\s+FROM\s+messages/i.test(sql))).toBe(false)
    expect(r2.get).not.toHaveBeenCalled()
    expect(r2.deleted).toEqual([])
  })
})

function app() {
  return createApp()
}
