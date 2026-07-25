import type { Env } from './env'
import { createApp } from './http/app'

const app = createApp()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
  async email(message: ForwardableEmailMessage, _env: Env): Promise<void> {
    // Task 5
    message.setReject('not implemented')
  },
}
