import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAlias } from '../src/aliases/service'
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/session'
import type { Env } from '../src/env'
import { createApp } from '../src/http/app'
import { insertDraft } from '../src/messages/service'
import { resetRateLimits } from '../src/send/rate-limit'
import { claimWebSendRequest, WEB_SEND_PROCESSING_MS } from '../src/send/web-requests'
import { sqliteD1 } from './helpers/sqlite-d1'

const app = createApp()
const secret = 'local-web-send-test-secret-at-least-32-chars'
const mail = { to: ['one@example.com', 'two@example.com'], subject: 'Hi', text: 'Hello' }
let database: ReturnType<typeof sqliteD1>
let env: Env
let fromAliasId: string
let cookie: string

beforeEach(async () => {
  database = sqliteD1()
  env = {
    DB: database.db,
    EMAIL_DOMAIN: 'example.com',
    COOKIES_SECRET: secret,
    RESEND_API_KEY: 'test-provider-key',
    ASSETS: {} as Fetcher,
  }
  cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie('admin', secret)}`
  fromAliasId = (await createAlias(database.db, { address: 'me', domain: env.EMAIL_DOMAIN })).id
})

afterEach(() => {
  database.sqlite.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetRateLimits()
})

function post(key: string | null = 'send-1', fields: Record<string, unknown> = {}) {
  return app.request('http://localhost/api/messages/send', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...(key === null ? {} : { 'Idempotency-Key': key }),
    },
    body: JSON.stringify({ fromAliasId, ...mail, ...fields }),
  }, env)
}

function status(key = 'send-1', reconcile = false) {
  const path = `http://localhost/api/messages/send/${key}${reconcile ? '/reconcile' : ''}`
  return app.request(path, { method: reconcile ? 'POST' : 'GET', headers: { Cookie: cookie } }, env)
}

function createDraft() {
  return insertDraft(database.db, {
    aliasId: fromAliasId,
    fromAddr: 'me@example.com',
    toAddrs: mail.to,
    subject: mail.subject,
    textBody: mail.text,
  })
}

function providerSuccess() {
  return new Response(JSON.stringify({ id: 'provider-123' }), {
    status: 200,
    headers: { 'x-resend-daily-quota': '5', 'x-resend-monthly-quota': '50' },
  })
}

function installDelayedProvider() {
  let ready!: () => void
  let resolve!: (response: Response) => void
  const called = new Promise<void>((resolveCalled) => { ready = resolveCalled })
  const response = new Promise<Response>((resolveResponse) => { resolve = resolveResponse })
  const fetcher = vi.fn<(_url: string, _init: RequestInit) => Promise<Response>>(() => {
    ready()
    return response
  })
  vi.stubGlobal('fetch', fetcher)
  return { called, resolve, fetcher }
}

function records() {
  return database.sqlite.prepare(`
    SELECT id, folder, direction, provider_message_id, subject FROM messages ORDER BY folder
  `).all()
}

function usage() {
  return database.sqlite.prepare('SELECT provider, units FROM send_usage_events').all()
}

describe('web send state and replay', () => {
  it('claims an unmodified draft once in D1 even when two requests reached the insert', async () => {
    const { id: draftId } = await createDraft()
    const draft = database.sqlite.prepare('SELECT created_at FROM messages WHERE id = ?').get(draftId) as {
      created_at: number
    }
    const claim = (key: string, updatedAt = draft.created_at) =>
      claimWebSendRequest(database.db, key, 'payload-hash', draftId, updatedAt)
    await expect(claim('stale', draft.created_at - 1)).resolves.toBeNull()
    const attempts = await Promise.all([claim('key-a'), claim('key-b')])
    expect(attempts.filter(Boolean)).toHaveLength(1)
  })

  it('requires a session and a valid key, and rejects disabled aliases', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const anonymous = await app.request('http://localhost/api/messages/send/send-1', {}, env)
    expect(anonymous.status).toBe(401)
    const missing = await post(null)
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ error: 'invalid_idempotency_key' })
    database.sqlite.prepare('UPDATE aliases SET enabled = 0 WHERE id = ?').run(fromAliasId)
    const disabled = await post()
    expect(disabled.status).toBe(400)
    expect(await disabled.json()).toMatchObject({ error: 'invalid_address', status: 'failed' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('claims a draft once across tabs, drops the incorrect Reply-To, and commits Sent and quota together', async () => {
    const { id: draftId } = await createDraft()
    const originalId = 'original-inbound'
    database.sqlite.prepare(`
      INSERT INTO messages (id, alias_id, folder, direction, from_addr, to_addrs, created_at)
      VALUES (?, ?, 'inbox', 'inbound', 'original@example.com', '[]', 1)
    `).run(originalId, fromAliasId)
    const { called, resolve, fetcher } = installDelayedProvider()
    const payload = { draftId, replyToMessageId: originalId }
    const original = post('send-1', payload)
    await called
    const same = await post('send-1', payload)
    expect(same.status).toBe(409)
    expect(await same.json()).toMatchObject({ error: 'send_processing', status: 'processing' })
    const other = await post('send-2', payload)
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ error: 'draft_send_exists', requestKey: 'send-1' })
    const conflict = await post('send-1', { ...payload, subject: 'Changed' })
    expect(await conflict.json()).toMatchObject({ error: 'idempotency_conflict' })

    resolve(providerSuccess())
    const accepted = await original
    expect(accepted.status).toBe(200)
    const body = await accepted.json() as { id: string }
    expect(body).toMatchObject({ status: 'accepted', saved: true, providerMessageId: 'provider-123' })
    expect(await (await status()).json()).toEqual(body)
    // Key lookup precedes draft validation, so it works after the draft was removed.
    expect(await (await post('send-1', { ...payload, to: [' one@example.com ', 'two@example.com'] })).json()).toEqual(body)

    expect(fetcher).toHaveBeenCalledOnce()
    const request = fetcher.mock.calls[0][1]
    expect(JSON.parse(String(request.body))).toEqual({ from: 'me@example.com', ...mail })
    expect(new Headers(request.headers).get('Idempotency-Key')).toBe(`mfp/web/${body.id}`)
    expect(records()).toEqual([
      expect.objectContaining({ id: originalId, folder: 'inbox' }),
      { id: body.id, folder: 'sent', direction: 'outbound', provider_message_id: 'provider-123', subject: mail.subject },
    ])
    expect(usage()).toEqual([{ provider: 'resend', units: 2 }])
    expect(database.sqlite.prepare('SELECT daily_used, monthly_used FROM provider_quota_reports').get())
      .toEqual({ daily_used: 5, monthly_used: 50 })
  })

  it('keeps unknown outcomes and never redispatches even under a different key for the same draft', async () => {
    const { id: draftId } = await createDraft()
    const fetcher = vi.fn().mockResolvedValue(new Response('unavailable', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const unknown = await post('send-1', { draftId })
    expect(unknown.status).toBe(409)
    expect(await unknown.json()).toMatchObject({ error: 'send_outcome_unknown', status: 'unknown' })
    expect(await (await status('send-1', true)).json()).toMatchObject({ error: 'send_outcome_unknown' })
    expect(await (await post('send-1', { draftId })).json()).toMatchObject({ error: 'send_outcome_unknown' })
    expect(await (await post('send-2', { draftId })).json()).toMatchObject({ error: 'draft_send_exists' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(records()).toEqual([expect.objectContaining({ id: draftId, folder: 'draft' })])
    expect(usage()).toEqual([])
  })

  it('allows a new key after a definitive rejection, while replaying the failed key unchanged', async () => {
    const { id: draftId } = await createDraft()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('invalid', { status: 422 }))
      .mockResolvedValueOnce(providerSuccess())
    vi.stubGlobal('fetch', fetcher)
    const failed = await post('send-1', { draftId })
    expect(failed.status).toBe(400)
    expect(await failed.json()).toMatchObject({ error: 'invalid_address', status: 'failed' })
    expect(await (await post('send-1', { draftId })).json()).toMatchObject({ status: 'failed' })
    expect(await (await status()).json()).toMatchObject({ status: 'failed' })
    expect(usage()).toEqual([])
    expect(await (await post('send-2', { draftId })).json()).toMatchObject({ status: 'accepted', saved: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reconciles an accepted send after a failed D1 transaction without dispatching or counting twice', async () => {
    const { id: draftId } = await createDraft()
    const fetcher = vi.fn().mockResolvedValue(providerSuccess())
    vi.stubGlobal('fetch', fetcher)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    database.sqlite.exec(`
      CREATE TRIGGER fail_sent_write BEFORE INSERT ON messages
      WHEN NEW.folder = 'sent' BEGIN SELECT RAISE(ABORT, 'simulated D1 write error'); END;
    `)
    const accepted = await post('send-1', { draftId })
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({ status: 'accepted', saved: false })
    expect(warn).toHaveBeenCalledOnce()
    expect(records()).toEqual([expect.objectContaining({ id: draftId, folder: 'draft' })])
    expect(usage()).toEqual([])
    expect(await (await status()).json()).toMatchObject({ status: 'accepted', saved: false })

    database.sqlite.exec('DROP TRIGGER fail_sent_write')
    const reconciled = await Promise.all([status('send-1', true), status('send-1', true)])
    for (const response of reconciled) {
      expect(await response.json()).toMatchObject({ status: 'accepted', saved: true })
    }
    expect(database.sqlite.prepare('SELECT state, pending_payload FROM web_send_requests').get())
      .toEqual({ state: 'accepted', pending_payload: null })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(records()).toEqual([expect.objectContaining({ folder: 'sent' })])
    expect(usage()).toEqual([{ provider: 'resend', units: 2 }])
  })

  it('reports interrupted processing as unknown without releasing the draft, and preserves concurrent edits', async () => {
    const { id: draftId } = await createDraft()
    const { called, resolve, fetcher } = installDelayedProvider()
    const pending = post('send-1', { draftId })
    await called
    database.sqlite.prepare('UPDATE web_send_requests SET created_at = ?').run(Date.now() - WEB_SEND_PROCESSING_MS)
    expect(await (await status()).json()).toMatchObject({ error: 'send_outcome_unknown' })
    expect(await (await post('send-2', { draftId })).json()).toMatchObject({ error: 'draft_send_exists' })
    database.sqlite.prepare('UPDATE messages SET subject = ?, created_at = created_at + 1 WHERE id = ?')
      .run('edited in another tab', draftId)
    resolve(providerSuccess())
    expect(await (await pending).json()).toMatchObject({ status: 'accepted', saved: true })
    expect(records()).toEqual([
      expect.objectContaining({ folder: 'draft', subject: 'edited in another tab' }),
      expect.objectContaining({ folder: 'sent', subject: mail.subject }),
    ])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('does not dispatch a stale saved draft after edits in another tab', async () => {
    const { id: draftId } = await createDraft()
    database.sqlite.prepare('UPDATE messages SET subject = ? WHERE id = ?').run('newer draft', draftId)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const stale = await post('send-1', { draftId })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'send_draft_changed', status: 'failed' })
    expect(fetcher).not.toHaveBeenCalled()
    expect((await status()).status).toBe(404)
  })
})
