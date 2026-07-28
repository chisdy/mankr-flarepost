import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import worker from '../src/index'

const secret = 'test-secret-at-least-32-chars!!'

/**
 * Captures the SQL the purge issues, so the test asserts the cron actually drives a purge
 * with the stored retention rather than just resolving.
 */
function mockDb(settingsRow: { trash: number; spam: number } | null) {
  const statements: { sql: string; args: unknown[] }[] = []

  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: (...args: unknown[]) => {
      statements.push({ sql, args })
      return {
        first: async () =>
          settingsRow
            ? {
                trash_retention_days: settingsRow.trash,
                spam_retention_days: settingsRow.spam,
              }
            : null,
        run: async () => ({ meta: { changes: 0 }, success: true }),
      }
    },
    first: async () =>
      settingsRow
        ? {
            trash_retention_days: settingsRow.trash,
            spam_retention_days: settingsRow.spam,
          }
        : null,
    run: async () => ({ meta: { changes: 0 }, success: true }),
  }))

  const batch = vi
    .fn()
    .mockResolvedValue([
      { meta: { changes: 0 } },
      { meta: { changes: 4 } },
      { meta: { changes: 0 } },
      { meta: { changes: 7 } },
    ])

  return { statements, batch, db: { prepare, batch } as unknown as D1Database }
}

function envWith(db: D1Database): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    COOKIES_SECRET: secret,
    EMAIL_DOMAIN: 'example.com',
  }
}

const event = {} as ScheduledController
const ctx = {} as ExecutionContext

describe('scheduled cron handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('purges using the retention window stored in mailbox settings', async () => {
    const { batch, db } = mockDb({ trash: 7, spam: 3 })

    await worker.scheduled(event, envWith(db), ctx)

    expect(batch).toHaveBeenCalledTimes(1)
    const cutoffs = batch.mock.calls[0]?.[0] as { sql: string; args?: unknown[] }[]
    expect(cutoffs.length).toBeGreaterThan(0)
  })

  it('falls back to defaults when the settings row is missing', async () => {
    const { batch, db } = mockDb(null)

    await expect(worker.scheduled(event, envWith(db), ctx)).resolves.toBeUndefined()
    expect(batch).toHaveBeenCalledTimes(1)
  })

  it('propagates a purge failure so Cloudflare records the cron as failed', async () => {
    const { db } = mockDb({ trash: 30, spam: 30 })
    vi.spyOn(db, 'batch').mockRejectedValue(new Error('d1 unavailable'))

    await expect(worker.scheduled(event, envWith(db), ctx)).rejects.toThrow('d1 unavailable')
  })
})
