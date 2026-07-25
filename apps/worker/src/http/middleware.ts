import { createMiddleware } from 'hono/factory'
import type { Env } from '../env'
import { readSession } from '../auth/session'
import { jsonError } from './errors'

export type AppVariables = {
  userId: string
}

export const requireSession = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const session = await readSession(c.req.header('Cookie') ?? null, c.env.COOKIES_SECRET)
    if (!session) {
      return jsonError(c, 401, 'unauthorized')
    }
    c.set('userId', session.userId)
    await next()
  },
)
