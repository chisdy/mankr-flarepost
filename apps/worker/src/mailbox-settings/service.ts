export type MailboxSettings = {
  trashRetentionDays: number
  spamRetentionDays: number
}

export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 90
export const DEFAULT_RETENTION_DAYS = 30

export const DEFAULT_MAILBOX_SETTINGS: MailboxSettings = {
  trashRetentionDays: DEFAULT_RETENTION_DAYS,
  spamRetentionDays: DEFAULT_RETENTION_DAYS,
}

export function isRetentionDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_RETENTION_DAYS &&
    value <= MAX_RETENTION_DAYS
  )
}

function clampDays(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.round(n)))
}

/** Reads the single settings row, falling back to defaults if the row is missing. */
export async function getMailboxSettings(db: D1Database): Promise<MailboxSettings> {
  const row = await db
    .prepare(
      'SELECT trash_retention_days, spam_retention_days FROM mailbox_settings WHERE id = 1',
    )
    .first<{ trash_retention_days: number; spam_retention_days: number }>()

  if (!row) return { ...DEFAULT_MAILBOX_SETTINGS }

  return {
    trashRetentionDays: clampDays(row.trash_retention_days),
    spamRetentionDays: clampDays(row.spam_retention_days),
  }
}

export async function updateMailboxSettings(
  db: D1Database,
  patch: Partial<MailboxSettings>,
): Promise<MailboxSettings> {
  const current = await getMailboxSettings(db)
  const next: MailboxSettings = {
    trashRetentionDays: patch.trashRetentionDays ?? current.trashRetentionDays,
    spamRetentionDays: patch.spamRetentionDays ?? current.spamRetentionDays,
  }

  await db
    .prepare(
      `INSERT INTO mailbox_settings (id, trash_retention_days, spam_retention_days)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         trash_retention_days = excluded.trash_retention_days,
         spam_retention_days = excluded.spam_retention_days`,
    )
    .bind(next.trashRetentionDays, next.spamRetentionDays)
    .run()

  return next
}
