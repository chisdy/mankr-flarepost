import { Hono } from 'hono'
import type { Env } from '../env'
import { registerAuthRoutes } from '../auth/routes'
import { jsonError } from './errors'
import { requireSession, type AppVariables } from './middleware'

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>()

  // Public + authed auth routes (login/setup are unguarded inside registerAuthRoutes)
  registerAuthRoutes(app)

  // Gate unknown / future /api/* routes
  app.use('/api/*', requireSession)
  app.all('/api/*', (c) => jsonError(c, 404, 'not_found'))

  return app
}
