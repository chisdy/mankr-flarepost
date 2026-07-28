import type { Hono } from 'hono'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  type MailboxSettings,
  getMailboxSettings,
  isRetentionDays,
  updateMailboxSettings,
} from './service'

type MailboxSettingsApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerMailboxSettingsRoutes(app: MailboxSettingsApp): void {
  app.get('/api/mailbox-settings', async (c) => {
    const settings = await getMailboxSettings(c.env.DB)
    return c.json(settings)
  })

  app.patch('/api/mailbox-settings', async (c) => {
    let body: { trashRetentionDays?: unknown; spamRetentionDays?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const patch: Partial<MailboxSettings> = {}
    if (body.trashRetentionDays !== undefined) {
      if (!isRetentionDays(body.trashRetentionDays)) {
        return jsonError(c, 400, 'invalid_retention_days')
      }
      patch.trashRetentionDays = body.trashRetentionDays
    }
    if (body.spamRetentionDays !== undefined) {
      if (!isRetentionDays(body.spamRetentionDays)) {
        return jsonError(c, 400, 'invalid_retention_days')
      }
      patch.spamRetentionDays = body.spamRetentionDays
    }

    if (patch.trashRetentionDays === undefined && patch.spamRetentionDays === undefined) {
      return jsonError(c, 400, 'invalid_body')
    }

    const updated = await updateMailboxSettings(c.env.DB, patch)
    return c.json(updated)
  })
}
