export class DraftQueue {
  #tail: Promise<unknown> = Promise.resolve()

  run<T>(save: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(save)
    this.#tail = result.catch(() => undefined)
    return result
  }

  settled(): Promise<unknown> {
    return this.#tail
  }
}

export type SendAttempt = {
  draftId: string
  key: string
  fingerprint?: string
  body?: string
  accepted?: boolean
}

function attemptSlot(draftId: string) {
  return `mankr:compose:send:${draftId}`
}

export function readSendAttempt(draftId: string): SendAttempt | null {
  try {
    const raw = localStorage.getItem(attemptSlot(draftId))
    if (!raw) return null
    const { key, fingerprint, accepted } = JSON.parse(raw)
    if (typeof key !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(key))
      return null
    return {
      draftId,
      key,
      fingerprint: typeof fingerprint === "string" ? fingerprint : undefined,
      accepted: accepted === true,
    }
  } catch {
    return null
  }
}

export function rememberSendAttempt(attempt: SendAttempt) {
  try {
    // Store request identity only. The saved draft remains the source of the mail content.
    localStorage.setItem(
      attemptSlot(attempt.draftId),
      JSON.stringify({
        key: attempt.key,
        fingerprint: attempt.fingerprint,
        accepted: attempt.accepted,
      })
    )
  } catch {
    // The server also guards concurrent sends of the same draft.
  }
}

export function forgetSendAttempt(attempt: SendAttempt) {
  try {
    if (readSendAttempt(attempt.draftId)?.key === attempt.key) {
      localStorage.removeItem(attemptSlot(attempt.draftId))
    }
  } catch {
    // Storage is optional; the request is still tracked by the server.
  }
}

export async function fingerprintSendBody(body: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export async function retryBody(attempt: SendAttempt, savedBody?: string) {
  if (attempt.accepted) return undefined
  if (attempt.body !== undefined) return attempt.body
  if (!savedBody || !attempt.fingerprint) return undefined
  return (await fingerprintSendBody(savedBody)) === attempt.fingerprint
    ? savedBody
    : undefined
}
