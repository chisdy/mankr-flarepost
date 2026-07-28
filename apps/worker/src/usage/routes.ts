import type { Hono } from 'hono'
import type { Env } from '../env'
import type { AppVariables } from '../http/middleware'
import { getUsageSnapshot } from './service'

type UsageApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerUsageRoutes(app: UsageApp): void {
  app.get('/api/usage', async (c) => {
    return c.json(await getUsageSnapshot(c.env))
  })
}
