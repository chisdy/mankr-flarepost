import { LOG_RETENTION_MS } from './service'

type LogRow = {
  id: string
  api_key_id: string
  name: string
  key_prefix: string
  from_addr: string
  to_addrs: string
  subject: string
  status: 'sent' | 'failed'
  error_code: string | null
  provider_message_id: string | null
  created_at: number
}

export function parseLogCursor(
  raw: string,
): { time: number; id: string } | null {
  try {
    const value = JSON.parse(atob(raw)) as unknown
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !Number.isSafeInteger(value[0]) ||
      value[0] < 0 ||
      typeof value[1] !== 'string' ||
      !/^[\w-]{1,100}$/.test(value[1])
    )
      return null
    return { time: value[0], id: value[1] }
  } catch {
    return null
  }
}

export async function listSendLogs(
  db: D1Database,
  options: {
    apiKeyId?: string
    status?: 'sent' | 'failed'
    limit: number
    cursor?: { time: number; id: string }
    now?: number
  },
) {
  const clauses = ['l.created_at >= ?']
  const values: (string | number)[] = [
    (options.now ?? Date.now()) - LOG_RETENTION_MS,
  ]
  if (options.apiKeyId) {
    clauses.push('l.api_key_id = ?')
    values.push(options.apiKeyId)
  }
  if (options.status) {
    clauses.push('l.status = ?')
    values.push(options.status)
  }
  if (options.cursor) {
    clauses.push('(l.created_at < ? OR (l.created_at = ? AND l.id < ?))')
    values.push(options.cursor.time, options.cursor.time, options.cursor.id)
  }
  const { results } = await db
    .prepare(
      `
    SELECT l.*, k.name, k.key_prefix FROM api_send_logs l
    JOIN api_keys k ON k.id = l.api_key_id
    WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT ?
  `,
    )
    .bind(...values, options.limit + 1)
    .all<LogRow>()
  const rows = results ?? []
  const page = rows.slice(0, options.limit)
  const last = page.at(-1)
  return {
    logs: page.map((row) => ({
      id: row.id,
      apiKeyId: row.api_key_id,
      projectName: row.name,
      keyPrefix: row.key_prefix,
      fromAddr: row.from_addr,
      toAddrs: JSON.parse(row.to_addrs) as string[],
      subject: row.subject,
      status: row.status,
      errorCode: row.error_code,
      providerMessageId: row.provider_message_id,
      createdAt: row.created_at,
    })),
    nextCursor:
      rows.length > options.limit && last
        ? btoa(JSON.stringify([last.created_at, last.id]))
        : null,
  }
}
