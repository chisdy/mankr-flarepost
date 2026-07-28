import type { Hono } from 'hono'
import { isSendProviderId, type SendProviderId } from '../adapters/send'
import type { Env } from '../env'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import {
  getSendProvidersSnapshot,
  updateSendProviders,
  type UpdateSendProvidersInput,
} from './service'

type SendProvidersApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerSendProviderRoutes(app: SendProvidersApp): void {
  app.get('/api/send-providers', async (c) => {
    const snapshot = await getSendProvidersSnapshot(c.env)
    return c.json(snapshot)
  })

  app.put('/api/send-providers', async (c) => {
    let body: {
      activeProvider?: unknown
      secrets?: unknown
    }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const input: UpdateSendProvidersInput = {}
    let touched = false

    if ('activeProvider' in body) {
      if (body.activeProvider === null) {
        input.activeProvider = null
        touched = true
      } else if (isSendProviderId(body.activeProvider)) {
        input.activeProvider = body.activeProvider
        touched = true
      } else {
        return jsonError(c, 400, 'invalid_body')
      }
    }

    if (body.secrets !== undefined) {
      if (!Array.isArray(body.secrets)) {
        return jsonError(c, 400, 'invalid_body')
      }
      const secrets: Array<{ provider: SendProviderId; apiKey: string }> = []
      for (const entry of body.secrets) {
        if (
          !entry ||
          typeof entry !== 'object' ||
          !isSendProviderId((entry as { provider?: unknown }).provider) ||
          typeof (entry as { apiKey?: unknown }).apiKey !== 'string'
        ) {
          return jsonError(c, 400, 'invalid_body')
        }
        secrets.push({
          provider: (entry as { provider: SendProviderId }).provider,
          apiKey: (entry as { apiKey: string }).apiKey,
        })
      }
      input.secrets = secrets
      touched = true
    }

    if (!touched) {
      return jsonError(c, 400, 'invalid_body')
    }

    const snapshot = await updateSendProviders(c.env, input)
    return c.json(snapshot)
  })
}
