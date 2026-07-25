import type { Env } from './env'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ ok: true, service: 'mankr-mail' })
    }
    return env.ASSETS.fetch(request)
  },
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    // Task 5
    message.setReject('not implemented')
  },
}
