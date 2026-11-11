import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { parseInboundMime } from '../src/inbound/parse'
import { handleInboundEmail } from '../src/inbound/handler'
import { createAlias } from '../src/aliases/service'
import type { Env } from '../src/env'
import { getMessage } from '../src/messages/service'
import { sqliteD1 } from './helpers/sqlite-d1'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample.eml')
const sampleEml = readFileSync(fixturePath)

describe('parseInboundMime', () => {
  it('extracts text, html, and flags attachments from multipart fixture', async () => {
    const parsed = await parseInboundMime(sampleEml.buffer.slice(
      sampleEml.byteOffset,
      sampleEml.byteOffset + sampleEml.byteLength,
    ))

    expect(parsed.subject).toBe('Fixture multipart')
    expect(parsed.fromAddr).toMatch(/sender@example\.com/i)
    expect(parsed.textBody).toContain('Hello plain text body')
    expect(parsed.htmlBody).toContain('<b>HTML</b>')
    expect(parsed.hasAttachments).toBe(true)
    expect(parsed.replyToAddrs).toEqual([])
  })
})

function mockForwardableEmail(opts: {
  to: string
  from?: string
  raw: ArrayBuffer | Uint8Array
}): ForwardableEmailMessage {
  const bytes = opts.raw instanceof Uint8Array ? opts.raw : new Uint8Array(opts.raw)
  const setReject = vi.fn()
  return {
    from: opts.from ?? 'sender@example.com',
    to: opts.to,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
    headers: new Headers(),
    rawSize: bytes.byteLength,
    setReject,
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage
}

describe('handleInboundEmail', () => {
  it('delivers directly to the sixth alias and respects its enabled state', async () => {
    const { db, sqlite } = sqliteD1()
    try {
      for (let i = 1; i <= 5; i++) {
        await createAlias(db, { address: `existing-${i}`, domain: 'example.com' })
      }
      const alias = await createAlias(db, { address: 'orders', domain: 'example.com' })
      const receive = () => handleInboundEmail(
        mockForwardableEmail({ to: 'Orders@EXAMPLE.COM', raw: sampleEml }),
        { DB: db } as Env,
      )

      await receive()
      sqlite.prepare('UPDATE aliases SET enabled = 0 WHERE id = ?').run(alias.id)
      await receive()

      expect(sqlite.prepare('SELECT alias_id, folder FROM messages').all()).toEqual([
        { alias_id: alias.id, folder: 'inbox' },
      ])
    } finally {
      sqlite.close()
    }
  })

  it('stores parsed Reply-To mailboxes separately from the original From', async () => {
    const { db, sqlite } = sqliteD1()
    try {
      await createAlias(db, { address: 'me', domain: 'example.com' })
      const raw = new TextEncoder().encode([
        'From: Author <sender@example.com>',
        'To: me@example.com',
        'Reply-To: Support <help@example.com>, Escalations: triage@example.com, help@example.com;',
        'Subject: Reply destination',
        '',
        'Please use our support address.',
      ].join('\r\n'))
      await handleInboundEmail(mockForwardableEmail({ to: 'me@example.com', raw }), { DB: db } as Env)
      const row = sqlite.prepare('SELECT id FROM messages').get() as { id: string }
      await expect(getMessage(db, row.id)).resolves.toMatchObject({
        fromAddr: 'sender@example.com',
        replyToAddrs: ['help@example.com', 'triage@example.com'],
      })
    } finally {
      sqlite.close()
    }
  })

  it('inserts inbox message for enabled alias (case-insensitive)', async () => {
    const first = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'alias-1',
        address: 'me@example.com',
        enabled: 1,
        is_default: 1,
        created_at: 1,
      })
      .mockResolvedValueOnce({
        id: 'msg-1',
        alias_id: 'alias-1',
        from_addr: 'sender@example.com',
        subject: 'Fixture multipart',
        text_body: 'Hello plain text body',
        folder: 'inbox',
      })
    const all = vi.fn().mockResolvedValue({ results: [] })
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const stmt = { first, run, all, bind: vi.fn() }
    stmt.bind.mockReturnValue(stmt)
    const prepare = vi.fn().mockReturnValue(stmt)
    const env = {
      DB: { prepare } as unknown as D1Database,
      EMAIL_DOMAIN: 'example.com',
    } as Env

    const message = mockForwardableEmail({
      to: 'Me@Example.COM',
      raw: sampleEml,
    })

    await handleInboundEmail(message, env)

    expect(message.setReject).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalled()
    const insertSql = prepare.mock.calls.map((c) => String(c[0])).find((s) => /INSERT\s+INTO\s+messages/i.test(s))
    expect(insertSql).toBeTruthy()
    expect(insertSql).toMatch(/folder/i)

    const insertBind = stmt.bind.mock.calls.find((c) =>
      Array.isArray(c) && c.some((v) => v === 'inbox' || v === 'inbound'),
    )
    expect(insertBind).toBeTruthy()
    expect(insertBind).toEqual(
      expect.arrayContaining([
        expect.any(String), // id
        'alias-1',
        'inbox',
        'inbound',
        expect.stringMatching(/sender@example\.com/i),
        expect.stringContaining('Me@Example.COM'),
        'Fixture multipart',
        expect.stringContaining('Hello plain text body'),
        expect.stringContaining('<b>HTML</b>'),
        0, // is_read
        1, // has_unsupported_attachments — fixture carries a part we never store
        expect.any(Number), // created_at
      ]),
    )
    // filters queried after insert
    expect(
      prepare.mock.calls.some((c) => /FROM\s+filters/i.test(String(c[0]))),
    ).toBe(true)
  })

  it('accepts and drops unknown address without setReject or insert', async () => {
    const first = vi.fn().mockResolvedValue(null)
    const run = vi.fn()
    const bind = vi.fn().mockReturnValue({ first, run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const env = {
      DB: { prepare } as unknown as D1Database,
      EMAIL_DOMAIN: 'example.com',
    } as Env

    const message = mockForwardableEmail({
      to: 'unknown@example.com',
      raw: sampleEml,
    })

    await handleInboundEmail(message, env)

    expect(message.setReject).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    const insertCalled = prepare.mock.calls.some((c) => /INSERT\s+INTO\s+messages/i.test(String(c[0])))
    expect(insertCalled).toBe(false)
  })

  it('drops disabled alias without insert', async () => {
    const first = vi.fn().mockResolvedValue(null) // enabled lookup returns null
    const run = vi.fn()
    const bind = vi.fn().mockReturnValue({ first, run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const env = {
      DB: { prepare } as unknown as D1Database,
      EMAIL_DOMAIN: 'example.com',
    } as Env

    const message = mockForwardableEmail({
      to: 'disabled@example.com',
      raw: sampleEml,
    })

    await handleInboundEmail(message, env)

    expect(message.setReject).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
