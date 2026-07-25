import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { parseInboundMime } from '../src/inbound/parse'
import { handleInboundEmail } from '../src/inbound/handler'
import type { Env } from '../src/env'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample.eml')
const sampleEml = readFileSync(fixturePath)

describe('parseInboundMime', () => {
  it('extracts text, html, and attachment flag from multipart fixture', async () => {
    const parsed = await parseInboundMime(sampleEml.buffer.slice(
      sampleEml.byteOffset,
      sampleEml.byteOffset + sampleEml.byteLength,
    ))

    expect(parsed.subject).toBe('Fixture multipart')
    expect(parsed.fromAddr).toMatch(/sender@example\.com/i)
    expect(parsed.textBody).toContain('Hello plain text body')
    expect(parsed.htmlBody).toContain('<b>HTML</b>')
    expect(parsed.hasUnsupportedAttachments).toBe(true)
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
        1, // has_unsupported_attachments
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
