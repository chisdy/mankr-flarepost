import type { Env } from './env'
import { createApp } from './http/app'
import { handleInboundEmail } from './inbound/handler'
import { getMailboxSettings } from './mailbox-settings/service'
import { purgeExpiredMessages } from './messages/service'

const app = createApp()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleInboundEmail(message, env)
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const settings = await getMailboxSettings(env.DB)
    await purgeExpiredMessages(env.DB, {
      trashDays: settings.trashRetentionDays,
      spamDays: settings.spamRetentionDays,
    })
  },
}
