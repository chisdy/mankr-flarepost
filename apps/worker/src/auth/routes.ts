import type { Hono } from 'hono'
import type { Env } from '../env'
import {
  findUserById,
  findUserByUsername,
  insertUser,
  updateUserPassword,
  countUsers,
} from '../db/client'
import { hashPassword, verifyPassword } from './password'
import {
  buildClearSessionSetCookie,
  buildSessionSetCookie,
  createSessionCookie,
} from './session'
import { jsonError } from '../http/errors'
import type { AppVariables } from '../http/middleware'
import { requireSession } from '../http/middleware'

type AuthApp = Hono<{ Bindings: Env; Variables: AppVariables }>

export function registerAuthRoutes(app: AuthApp): void {
  app.post('/api/auth/login', async (c) => {
    let body: { username?: unknown; password?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!username || !password) {
      return jsonError(c, 401, 'invalid_credentials')
    }

    const user = await findUserByUsername(c.env.DB, username)
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return jsonError(c, 401, 'invalid_credentials')
    }

    const value = await createSessionCookie(user.id, c.env.COOKIES_SECRET)
    c.header('Set-Cookie', buildSessionSetCookie(value))
    return c.json({
      username: user.username,
      displayName: user.display_name,
    })
  })

  app.post('/api/auth/logout', requireSession, async (c) => {
    c.header('Set-Cookie', buildClearSessionSetCookie())
    return c.json({ ok: true })
  })

  app.post('/api/auth/password', requireSession, async (c) => {
    let body: { currentPassword?: unknown; newPassword?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
    if (newPassword.length < 8) {
      return jsonError(c, 400, 'password_too_short')
    }

    const user = await findUserById(c.env.DB, c.get('userId'))
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      return jsonError(c, 401, 'invalid_credentials')
    }

    const passwordHash = await hashPassword(newPassword)
    await updateUserPassword(c.env.DB, user.id, passwordHash)
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', requireSession, async (c) => {
    const user = await findUserById(c.env.DB, c.get('userId'))
    if (!user) {
      return jsonError(c, 401, 'unauthorized')
    }
    return c.json({
      username: user.username,
      displayName: user.display_name,
    })
  })

  app.post('/api/setup', async (c) => {
    const existing = await countUsers(c.env.DB)
    if (existing > 0) {
      return jsonError(c, 403, 'already_initialized')
    }

    let body: { username?: unknown; password?: unknown; displayName?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'invalid_body')
    }

    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : null

    if (!username || password.length < 8) {
      return jsonError(c, 400, 'invalid_setup')
    }

    const id = crypto.randomUUID()
    const passwordHash = await hashPassword(password)
    await insertUser(c.env.DB, {
      id,
      username,
      passwordHash,
      displayName,
      createdAt: Date.now(),
    })

    const value = await createSessionCookie(id, c.env.COOKIES_SECRET)
    c.header('Set-Cookie', buildSessionSetCookie(value))
    return c.json({ username, displayName }, 201)
  })
}
