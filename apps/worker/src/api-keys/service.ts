export const KEY_PREFIX = 'mfp_live_'
export const SECRET_BYTES = 32
/** Chars of the random segment kept in `key_prefix` for UI identification. */
const PREFIX_RANDOM_CHARS = 8
export const MAX_API_KEYS = 20
export const MAX_KEY_NAME_LENGTH = 60
export const MIN_LIMIT = 1
export const MAX_LIMIT = 10_000
export const DEFAULT_HOURLY_LIMIT = 30
export const DEFAULT_DAILY_LIMIT = 200
/** Send log retention. Rows past this are pruned opportunistically on send. */
export const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type ApiKey = {
  id: string
  name: string
  keyPrefix: string
  aliasId: string
  aliasAddress: string
  enabled: boolean
  hourlyLimit: number
  dailyLimit: number
  createdAt: number
}

/** Key row joined with its alias, as needed to authorize a send. */
export type ApiKeyWithAlias = ApiKey & {
  aliasEnabled: boolean
}

export type ApiKeyUsage = {
  sent24h: number
  failed24h: number
  sent7d: number
  failed7d: number
  lastUsedAt: number | null
}

type ApiKeyRow = {
  id: string
  name: string
  key_prefix: string
  alias_id: string
  alias_address: string
  alias_enabled: number
  enabled: number
  hourly_limit: number
  daily_limit: number
  created_at: number
}

export class ApiKeyLimitError extends Error {
  readonly code = 'api_key_limit' as const
  constructor(message = `At most ${MAX_API_KEYS} API keys`) {
    super(message)
    this.name = 'ApiKeyLimitError'
  }
}

export class InvalidApiKeyInputError extends Error {
  readonly code = 'invalid_body' as const
  constructor(message = 'Invalid API key input') {
    super(message)
    this.name = 'InvalidApiKeyInputError'
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toHex(buffer: ArrayBuffer): string {
  let hex = ''
  for (const b of new Uint8Array(buffer)) hex += b.toString(16).padStart(2, '0')
  return hex
}

/** Full plaintext key. Returned to the caller once, never stored. */
export function generateApiKeySecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
  return `${KEY_PREFIX}${toBase64Url(bytes)}`
}

/**
 * SHA-256 of the plaintext key. Deliberately not PBKDF2 (used for passwords):
 * the secret is 256 bits of entropy, so key stretching buys nothing and would
 * add ~100k iterations of latency to every send.
 */
export async function hashApiKey(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return toHex(digest)
}

/** Displayable fragment: prefix plus the first few random chars. */
export function apiKeyPrefixOf(secret: string): string {
  const random = secret.startsWith(KEY_PREFIX) ? secret.slice(KEY_PREFIX.length) : secret
  return `${KEY_PREFIX}${random.slice(0, PREFIX_RANDOM_CHARS)}`
}

/** Extract the bearer token, or null when the header is missing/malformed. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1]! : null
}

export function normalizeKeyName(raw: string): string {
  return raw.trim().slice(0, MAX_KEY_NAME_LENGTH)
}

export function normalizeLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new InvalidApiKeyInputError('Limit must be an integer')
  }
  if (value < MIN_LIMIT || value > MAX_LIMIT) {
    throw new InvalidApiKeyInputError(`Limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`)
  }
  return value
}

function rowToApiKey(row: ApiKeyRow): ApiKeyWithAlias {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    aliasId: row.alias_id,
    aliasAddress: row.alias_address,
    aliasEnabled: row.alias_enabled === 1,
    enabled: row.enabled === 1,
    hourlyLimit: row.hourly_limit,
    dailyLimit: row.daily_limit,
    createdAt: row.created_at,
  }
}

const SELECT_KEY_WITH_ALIAS = `
  SELECT k.id, k.name, k.key_prefix, k.alias_id, k.enabled,
         k.hourly_limit, k.daily_limit, k.created_at,
         a.address AS alias_address, a.enabled AS alias_enabled
  FROM api_keys k
  JOIN aliases a ON a.id = k.alias_id
`

export async function listApiKeys(db: D1Database): Promise<ApiKeyWithAlias[]> {
  const { results } = await db
    .prepare(`${SELECT_KEY_WITH_ALIAS} ORDER BY k.created_at DESC`)
    .all<ApiKeyRow>()
  return (results ?? []).map(rowToApiKey)
}

export async function findApiKeyById(db: D1Database, id: string): Promise<ApiKeyWithAlias | null> {
  const row = await db
    .prepare(`${SELECT_KEY_WITH_ALIAS} WHERE k.id = ?`)
    .bind(id)
    .first<ApiKeyRow>()
  return row ? rowToApiKey(row) : null
}

/** Single indexed lookup used by the bearer-token middleware. */
export async function findApiKeyByHash(
  db: D1Database,
  keyHash: string,
): Promise<ApiKeyWithAlias | null> {
  const row = await db
    .prepare(`${SELECT_KEY_WITH_ALIAS} WHERE k.key_hash = ? LIMIT 1`)
    .bind(keyHash)
    .first<ApiKeyRow>()
  return row ? rowToApiKey(row) : null
}

export async function countApiKeys(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM api_keys').first<{ n: number }>()
  return row?.n ?? 0
}

export type CreateApiKeyInput = {
  name: string
  aliasId: string
  hourlyLimit?: number
  dailyLimit?: number
}

/** Creates the key and returns the plaintext secret exactly once. */
export async function createApiKey(
  db: D1Database,
  input: CreateApiKeyInput,
): Promise<{ apiKey: ApiKeyWithAlias; secret: string }> {
  const name = normalizeKeyName(input.name)
  if (!name) throw new InvalidApiKeyInputError('Name is required')

  const aliasId = input.aliasId.trim()
  const alias = await db
    .prepare('SELECT id, address, enabled FROM aliases WHERE id = ?')
    .bind(aliasId)
    .first<{ id: string; address: string; enabled: number }>()
  if (!alias) throw new InvalidApiKeyInputError('Alias not found')

  const hourlyLimit = normalizeLimit(input.hourlyLimit, DEFAULT_HOURLY_LIMIT)
  const dailyLimit = normalizeLimit(input.dailyLimit, DEFAULT_DAILY_LIMIT)

  if ((await countApiKeys(db)) >= MAX_API_KEYS) {
    throw new ApiKeyLimitError()
  }

  const secret = generateApiKeySecret()
  const id = crypto.randomUUID()
  const createdAt = Date.now()

  await db
    .prepare(
      `INSERT INTO api_keys (
         id, name, key_prefix, key_hash, alias_id, enabled,
         hourly_limit, daily_limit, created_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      name,
      apiKeyPrefixOf(secret),
      await hashApiKey(secret),
      aliasId,
      hourlyLimit,
      dailyLimit,
      createdAt,
    )
    .run()

  return {
    apiKey: {
      id,
      name,
      keyPrefix: apiKeyPrefixOf(secret),
      aliasId,
      aliasAddress: alias.address,
      aliasEnabled: alias.enabled === 1,
      enabled: true,
      hourlyLimit,
      dailyLimit,
      createdAt,
    },
    secret,
  }
}

export type PatchApiKeyInput = {
  name?: string
  enabled?: boolean
  hourlyLimit?: number
  dailyLimit?: number
}

export async function patchApiKey(
  db: D1Database,
  id: string,
  patch: PatchApiKeyInput,
): Promise<ApiKeyWithAlias | null> {
  const existing = await findApiKeyById(db, id)
  if (!existing) return null

  let name = existing.name
  if (patch.name !== undefined) {
    name = normalizeKeyName(patch.name)
    if (!name) throw new InvalidApiKeyInputError('Name is required')
  }
  const enabled = patch.enabled ?? existing.enabled
  const hourlyLimit = normalizeLimit(patch.hourlyLimit, existing.hourlyLimit)
  const dailyLimit = normalizeLimit(patch.dailyLimit, existing.dailyLimit)

  await db
    .prepare(
      'UPDATE api_keys SET name = ?, enabled = ?, hourly_limit = ?, daily_limit = ? WHERE id = ?',
    )
    .bind(name, enabled ? 1 : 0, hourlyLimit, dailyLimit, id)
    .run()

  return { ...existing, name, enabled, hourlyLimit, dailyLimit }
}

/** Deleting a key also drops its send logs and usage rows (ON DELETE CASCADE). */
export async function deleteApiKey(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run()
  return (result.meta.changes ?? 0) > 0
}

export type SendLogInput = {
  id: string
  apiKeyId: string
  fromAddr: string
  toAddrs: string[]
  subject: string
  status: 'sent' | 'failed'
  errorCode?: string | null
  providerMessageId?: string | null
}

/** Prepared statement so callers can batch it with the usage upsert. */
export function insertSendLogStatement(
  db: D1Database,
  input: SendLogInput,
  now = Date.now(),
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO api_send_logs (
         id, api_key_id, from_addr, to_addrs, subject, status,
         error_code, provider_message_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.apiKeyId,
      input.fromAddr,
      JSON.stringify(input.toAddrs),
      input.subject,
      input.status,
      input.errorCode ?? null,
      input.providerMessageId ?? null,
      now,
    )
}

export function pruneSendLogsStatement(db: D1Database, now = Date.now()): D1PreparedStatement {
  return db
    .prepare('DELETE FROM api_send_logs WHERE created_at < ?')
    .bind(now - LOG_RETENTION_MS)
}

export async function insertSendLog(
  db: D1Database,
  input: SendLogInput,
  now = Date.now(),
): Promise<void> {
  await insertSendLogStatement(db, input, now).run()
}

type UsageRow = {
  api_key_id: string
  sent_24h: number
  failed_24h: number
  sent_7d: number
  failed_7d: number
  last_used_at: number | null
}

/**
 * Usage stats aggregated from the send log, keyed by API key id. The usage
 * counter table is not used here: it only holds the short window the rate
 * limiter needs.
 */
export async function getUsageByKey(
  db: D1Database,
  now = Date.now(),
): Promise<Map<string, ApiKeyUsage>> {
  const since24h = now - 24 * 60 * 60 * 1000
  const since7d = now - 7 * 24 * 60 * 60 * 1000
  const { results } = await db
    .prepare(
      `SELECT api_key_id,
              SUM(CASE WHEN status = 'sent' AND created_at >= ? THEN 1 ELSE 0 END) AS sent_24h,
              SUM(CASE WHEN status = 'failed' AND created_at >= ? THEN 1 ELSE 0 END) AS failed_24h,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_7d,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_7d,
              MAX(created_at) AS last_used_at
       FROM api_send_logs
       WHERE created_at >= ?
       GROUP BY api_key_id`,
    )
    .bind(since24h, since24h, since7d)
    .all<UsageRow>()

  const usage = new Map<string, ApiKeyUsage>()
  for (const row of results ?? []) {
    usage.set(row.api_key_id, {
      sent24h: row.sent_24h ?? 0,
      failed24h: row.failed_24h ?? 0,
      sent7d: row.sent_7d ?? 0,
      failed7d: row.failed_7d ?? 0,
      lastUsedAt: row.last_used_at ?? null,
    })
  }
  return usage
}

export const EMPTY_USAGE: ApiKeyUsage = {
  sent24h: 0,
  failed24h: 0,
  sent7d: 0,
  failed7d: 0,
  lastUsedAt: null,
}
