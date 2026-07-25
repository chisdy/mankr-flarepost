import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ApiErrorBody = { error: string }

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  error: string,
): Response {
  return c.json({ error } satisfies ApiErrorBody, status)
}
