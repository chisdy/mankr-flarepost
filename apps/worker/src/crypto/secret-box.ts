const INFO = 'send-provider-secrets-v1'
const IV_BYTES = 12

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const b of view) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveAesKey(cookiesSecret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(cookiesSecret),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: enc.encode(INFO),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export type SealedSecret = {
  ciphertext: string
  iv: string
}

/** Encrypt `plain` with a key derived from COOKIES_SECRET. */
export async function seal(plain: string, cookiesSecret: string): Promise<SealedSecret> {
  const key = await deriveAesKey(cookiesSecret)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  )
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv) }
}

/**
 * Decrypt a sealed payload. Returns `null` on any failure (wrong key, corrupt data)
 * so callers can fall back to env without aborting the request.
 */
export async function open(
  payload: SealedSecret,
  cookiesSecret: string,
): Promise<string | null> {
  try {
    const key = await deriveAesKey(cookiesSecret)
    const iv = fromBase64(payload.iv)
    const ciphertext = fromBase64(payload.ciphertext)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

/** Last up to 4 characters of a secret for UI hints; never enough to reconstruct the key. */
export function keyHint(secret: string): string {
  const trimmed = secret.trim()
  if (!trimmed) return ''
  return trimmed.slice(-4)
}
