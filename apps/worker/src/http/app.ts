import { Hono } from 'hono'
import type { Env } from '../env'
import { registerAliasRoutes } from '../aliases/routes'
import { registerAuthRoutes } from '../auth/routes'
import { jsonError } from './errors'
import { requireSession, type AppVariables } from './middleware'

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>()

  // Public + authed auth routes (login/setup are unguarded inside registerAuthRoutes)
  registerAuthRoutes(app)

  // Authenticated API routes
  app.use('/api/*', requireSession)
  registerAliasRoutes(app)

  // Gate unknown / future /api/* routes
  app.all('/api/*', (c) => jsonError(c, 404, 'not_found'))

  return app
}
