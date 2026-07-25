export const MAX_ALIASES = 5

export type Alias = {
  id: string
  address: string
  enabled: boolean
  isDefault: boolean
  createdAt: number
}

export type AliasRow = {
  id: string
  address: string
  enabled: number
  is_default: number
  created_at: number
}

export class AliasLimitError extends Error {
  readonly code = 'alias_limit' as const

  constructor(message = `Free tier allows at most ${MAX_ALIASES} aliases`) {
    super(message)
    this.name = 'AliasLimitError'
  }
}

export class InvalidAddressError extends Error {
  readonly code = 'invalid_address' as const

  constructor(message = 'Invalid alias address') {
    super(message)
    this.name = 'InvalidAddressError'
  }
}

/** Normalize local-part or full address to `local@domain` (lowercase). */
export function normalizeAddress(localOrFull: string, domain: string): string {
  const domainNorm = domain.trim().toLowerCase()
  if (!domainNorm) {
    throw new InvalidAddressError('EMAIL_DOMAIN is required')
  }

  const raw = localOrFull.trim().toLowerCase()
  const at = raw.indexOf('@')
  const local = (at === -1 ? raw : raw.slice(0, at)).trim()

  if (!local || !/^[a-z0-9._+-]+$/i.test(local)) {
    throw new InvalidAddressError('Invalid local-part')
  }

  return `${local}@${domainNorm}`
}

export function assertCanCreate(count: number): void {
  if (count >= MAX_ALIASES) {
    throw new AliasLimitError()
  }
}

/** First alias, or any create when no default exists, becomes default. */
export function shouldAutoDefaultOnCreate(existingCount: number, hasDefault: boolean): boolean {
  if (existingCount === 0) return true
  return !hasDefault
}

export function rowToAlias(row: AliasRow): Alias {
  return {
    id: row.id,
    address: row.address,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  }
}

export async function listAliases(db: D1Database): Promise<Alias[]> {
  const { results } = await db
    .prepare(
      'SELECT id, address, enabled, is_default, created_at FROM aliases ORDER BY created_at ASC',
    )
    .all<AliasRow>()
  return (results ?? []).map(rowToAlias)
}

export async function countAliases(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM aliases').first<{ n: number }>()
  return row?.n ?? 0
}

export async function hasDefaultAlias(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM aliases WHERE is_default = 1 LIMIT 1')
    .first<{ ok: number }>()
  return row != null
}

export async function findAliasById(db: D1Database, id: string): Promise<Alias | null> {
  const row = await db
    .prepare(
      'SELECT id, address, enabled, is_default, created_at FROM aliases WHERE id = ?',
    )
    .bind(id)
    .first<AliasRow>()
  return row ? rowToAlias(row) : null
}

/** Case-insensitive lookup of an enabled alias by full address. */
export async function findEnabledAliasByAddress(
  db: D1Database,
  address: string,
): Promise<Alias | null> {
  const normalized = address.trim().toLowerCase()
  if (!normalized) return null
  const row = await db
    .prepare(
      `SELECT id, address, enabled, is_default, created_at
       FROM aliases
       WHERE lower(address) = ? AND enabled = 1
       LIMIT 1`,
    )
    .bind(normalized)
    .first<AliasRow>()
  return row ? rowToAlias(row) : null
}

export async function createAlias(
  db: D1Database,
  input: { address: string; domain: string },
): Promise<Alias> {
  const address = normalizeAddress(input.address, input.domain)
  const count = await countAliases(db)
  assertCanCreate(count)

  const isDefault = shouldAutoDefaultOnCreate(count, await hasDefaultAlias(db))
  const id = crypto.randomUUID()
  const createdAt = Date.now()

  try {
    await db
      .prepare(
        `INSERT INTO aliases (id, address, enabled, is_default, created_at)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .bind(id, address, isDefault ? 1 : 0, createdAt)
      .run()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/UNIQUE|constraint/i.test(msg)) {
      throw new InvalidAddressError('Alias address already exists')
    }
    throw e
  }

  return {
    id,
    address,
    enabled: true,
    isDefault,
    createdAt,
  }
}

export async function patchAlias(
  db: D1Database,
  id: string,
  patch: { enabled?: boolean; isDefault?: boolean },
): Promise<Alias | null> {
  const existing = await findAliasById(db, id)
  if (!existing) return null

  const enabled = patch.enabled ?? existing.enabled
  let isDefault = existing.isDefault

  if (patch.isDefault === true) {
    isDefault = true
    // Clear other defaults then set this one (batch for consistency)
    await db.batch([
      db.prepare('UPDATE aliases SET is_default = 0 WHERE is_default = 1'),
      db
        .prepare('UPDATE aliases SET enabled = ?, is_default = 1 WHERE id = ?')
        .bind(enabled ? 1 : 0, id),
    ])
  } else if (patch.isDefault === false) {
    isDefault = false
    await db
      .prepare('UPDATE aliases SET enabled = ?, is_default = 0 WHERE id = ?')
      .bind(enabled ? 1 : 0, id)
      .run()
  } else {
    await db
      .prepare('UPDATE aliases SET enabled = ? WHERE id = ?')
      .bind(enabled ? 1 : 0, id)
      .run()
  }

  return {
    ...existing,
    enabled,
    isDefault,
  }
}
