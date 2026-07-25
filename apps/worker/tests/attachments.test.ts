import { describe, expect, it, vi } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  makeR2Key,
  sanitizeContentType,
  sanitizeFilename,
  storeAttachment,
  toUint8Array,
  uint8ToBase64,
  AttachmentLimitError,
} from '../src/attachments/service'

describe('attachment helpers', () => {
  it('sanitizes filenames and content types', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('')).toBe('attachment')
    expect(sanitizeContentType('image/png; charset=utf-8')).toBe('image/png')
    expect(sanitizeContentType('not a type')).toBe('application/octet-stream')
  })

  it('encodes and builds r2 keys', () => {
    const bytes = toUint8Array('hello')
    expect(uint8ToBase64(bytes)).toBe(btoa('hello'))
    expect(makeR2Key('abc', Date.UTC(2026, 0, 1))).toBe('att/2026/abc')
  })

  it('rejects oversize uploads', async () => {
    const put = vi.fn()
    const del = vi.fn()
    const r2 = { put, delete: del } as unknown as R2Bucket
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    const bytes = new Uint8Array(MAX_ATTACHMENT_BYTES + 1)

    await expect(
      storeAttachment(db, r2, {
        filename: 'big.bin',
        contentType: 'application/octet-stream',
        bytes,
      }),
    ).rejects.toBeInstanceOf(AttachmentLimitError)
    expect(put).not.toHaveBeenCalled()
  })

  it('stores attachment to R2 and D1', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const del = vi.fn()
    const r2 = { put, delete: del } as unknown as R2Bucket
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database
    const bytes = toUint8Array('payload')

    const meta = await storeAttachment(db, r2, {
      filename: 'note.txt',
      contentType: 'text/plain',
      bytes,
    })

    expect(meta.filename).toBe('note.txt')
    expect(meta.sizeBytes).toBe(7)
    expect(put).toHaveBeenCalled()
    expect(prepare).toHaveBeenCalled()
    expect(String(prepare.mock.calls[0]?.[0])).toMatch(/INSERT\s+INTO\s+attachments/i)
  })
})
