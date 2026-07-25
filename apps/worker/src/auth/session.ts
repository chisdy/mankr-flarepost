export const SESSION_COOKIE_NAME = 'mankr_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const b of view) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toBase64Url(sig)
}

async function hmacVerify(payload: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  try {
    const sigBytes = fromBase64Url(signature)
    return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload))
  } catch {
    return false
  }
}

function parseCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=')
    if (rawKey === name) return rest.join('=')
  }
  return null
}

/** Returns the signed cookie value (not a full Set-Cookie header). */
export async function createSessionCookie(userId: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  const payload = `${userId}.${exp}`
  const sig = await hmacSign(payload, secret)
  return `${payload}.${sig}`
}

export async function readSession(
  cookieHeader: string | null,
  secret: string,
): Promise<{ userId: string } | null> {
  const value = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME)
  if (!value) return null

  const lastDot = value.lastIndexOf('.')
  if (lastDot <= 0) return null
  const payload = value.slice(0, lastDot)
  const sig = value.slice(lastDot + 1)
  if (!payload || !sig) return null

  const ok = await hmacVerify(payload, sig, secret)
  if (!ok) return null

  const sep = payload.lastIndexOf('.')
  if (sep <= 0) return null
  const userId = payload.slice(0, sep)
  const exp = Number(payload.slice(sep + 1))
  if (!userId || !Number.isFinite(exp)) return null
  if (Math.floor(Date.now() / 1000) > exp) return null

  return { userId }
}

export function buildSessionSetCookie(value: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join('; ')
}

export function buildClearSessionSetCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ].join('; ')
}
